import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ApplicationFailure } from '@temporalio/common';
import { isDone, readBacklog, startable, waiting } from '../backlog';
import { rebaseAndFastForward } from '../rebase';
import type { Changes, TestResult } from '../types/pipeline';
import type { SkillLoadedEvalCase } from '../types/skill-loaded-evals';
import { exec, git } from './exec';

// Every activity has to be safe to run twice: Temporal retries it when it fails or its worker dies.

// What a run leaves for the next one, not part of the work: .harness/run/, ignored by git
async function runFile(repoDir: string, name: string): Promise<string> {
  const dir = path.join(repoDir, '.harness/run');
  await mkdir(dir, { recursive: true });
  return path.join(dir, name);
}

// Writes .harness/run/feedback.md for the next agent run, or removes it (feedback = null)
export async function setFeedback(repoDir: string, feedback: string | null): Promise<void> {
  const file = await runFile(repoDir, 'feedback.md');
  if (feedback === null) {
    await rm(file, { force: true });
  } else {
    await writeFile(file, feedback + '\n');
  }
}

// The whole output goes to .harness/run/test-output.txt, the judge only gets its end
export async function runTests(repoDir: string): Promise<TestResult> {
  const { code, output } = await exec(repoDir, 'task', ['test'], { quiet: true });
  await writeFile(await runFile(repoDir, 'test-output.txt'), output);
  return { pass: code === 0, tail: output.slice(-3_000) };
}

export async function headCommit(repoDir: string): Promise<string> {
  return (await git(repoDir, 'rev-parse', 'HEAD')).trim();
}

// The branch you have checked out. Fails for good if it's none (a detached HEAD): there'd be nothing to merge into.
export async function currentBranch(repoDir: string): Promise<string> {
  const branch = (await git(repoDir, 'rev-parse', '--abbrev-ref', 'HEAD')).trim();
  if (branch === 'HEAD') throw ApplicationFailure.nonRetryable('You have no branch checked out (detached HEAD). Check out a branch first.');
  return branch;
}

// Throws away everything since `before`: commits, changes and new files
export async function resetTo(workDir: string, before: string): Promise<void> {
  await git(workDir, 'reset', '--hard', before);
  await git(workDir, 'clean', '-fd');
}

// At most `max` characters of a text, with a note where it was cut. The prompt goes to the agent as one
// argument, and Linux limits an argument to 128 KB.
export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n\n[… cut after ${max} characters, see the rest with git]`;
}

// What the agent changed since `before`: what the judge's rules look at, and what the judge reads
export async function changesSince(workDir: string, before: string): Promise<Changes> {
  const lines = (output: string) => output.split('\n').filter(Boolean);
  return {
    files: lines(await git(workDir, 'diff', '--name-only', before, 'HEAD')),
    uncommitted: lines(await git(workDir, 'status', '--porcelain')).map((line) => line.slice(3)),
    commits: truncate(await git(workDir, 'log', '-p', `${before}..HEAD`), 60_000),
  };
}

// The ids of all tickets in backlog/, in order: TICKET-1, TICKET-2, ...
export async function listTickets(repoDir: string): Promise<string[]> {
  return readBacklog(repoDir).map((ticket) => ticket.id);
}

// True when the ticket's file in backlog/ says `status: done`. Fails for good if there is no such ticket.
export async function ticketDone(repoDir: string, ticket: string): Promise<boolean> {
  const found = readBacklog(repoDir).find((t) => t.id === ticket);
  if (!found) {
    throw ApplicationFailure.nonRetryable(`There is no ${ticket} in backlog/.`);
  }
  return found.status === 'done';
}

// The ids of the tickets in backlog/ that can start: marked `status: ready`, or blocked only by tickets
// that are done by now
export async function readyTickets(repoDir: string): Promise<string[]> {
  return startable(readBacklog(repoDir)).map((ticket) => ticket.id);
}

// The tickets in backlog/ that wait, and for what: `TICKET-6: <why>`. Only the ones blocked by one of
// `tickets`, the tickets a pipeline worked on, not what's left from earlier work.
export async function blockedTickets(repoDir: string, tickets: string[]): Promise<string[]> {
  const backlog = readBacklog(repoDir);
  return waiting(backlog)
    .filter((ticket) => ticket.blockedBy.some((id) => tickets.includes(id)))
    .map((ticket) => {
      const notDone = ticket.blockedBy.filter((id) => !isDone(backlog, id)).map((id) => `${id} isn't done`);
      const why = [...notDone, ticket.blockedReason].filter(Boolean).join(', ');
      return `${ticket.id}: still blocked, ${why}`;
    });
}

// True while .harness/progress.md is there: the loop's memory, which it deletes when the ticket is done
export async function progressLeft(workDir: string): Promise<boolean> {
  return existsSync(path.join(workDir, '.harness/progress.md'));
}

// Creates .harness/worktrees/<name> with the branch checked out, a new branch from `commit`. If the branch is
// already there, it goes on with it (`flows ralph` after `--runs 1`). With `fresh`, it only does that when
// nothing happened on the branch yet, the case of a retry. Else it fails for good: a branch left over from an
// earlier run has other work on it.
export async function addWorktree(repoDir: string, name: string, branch: string, commit: string, fresh = false): Promise<string> {
  const dir = path.join(repoDir, '.harness/worktrees', name);
  // The branch's last commit, empty when there is no such branch yet
  const found = await exec(repoDir, 'git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { quiet: true });
  const tip = found.output.trim();
  if (tip && fresh && tip !== commit) {
    throw ApplicationFailure.nonRetryable(
      `${branch} is left over from an earlier run. Merge it, or delete it: git worktree remove --force .harness/worktrees/${name}; git branch -D ${branch}`,
    );
  }
  if (!(await git(repoDir, 'worktree', 'list', '--porcelain')).includes(`worktree ${dir}\n`)) {
    await git(repoDir, 'worktree', 'add', ...(tip ? [dir, branch] : ['-b', branch, dir, commit]));
  }
  return dir;
}

// Removes .harness/worktrees/<name> and its branch once the branch is merged. Fails harmlessly if an earlier attempt already did.
export async function removeWorktree(repoDir: string, name: string, branch: string): Promise<void> {
  await exec(repoDir, 'git', ['worktree', 'remove', '--force', path.join(repoDir, '.harness/worktrees', name)], { quiet: true });
  await exec(repoDir, 'git', ['branch', '-d', branch], { quiet: true });
}

// Fails for good if a file isn't committed as it is, for example a skill you just edited: the agents work
// in a worktree, which only has what's committed
export async function requireCommitted(repoDir: string, file: string): Promise<void> {
  const inHead = await exec(repoDir, 'git', ['cat-file', '-e', `HEAD:${file}`], { quiet: true });
  if (inHead.code !== 0) {
    throw ApplicationFailure.nonRetryable(`${file} isn't committed, or doesn't exist on this branch. The agents work in a worktree, which only has what's committed.`);
  }
  const unchanged = await exec(repoDir, 'git', ['diff', '--quiet', 'HEAD', '--', file], { quiet: true });
  if (unchanged.code !== 0) {
    throw ApplicationFailure.nonRetryable(`${file} has changes you didn't commit. The agents work in a worktree, which only has what's committed: commit them first.`);
  }
}

export async function branchDiffs(repoDir: string, branches: string[]): Promise<string> {
  let changes = '';
  for (const branch of branches) {
    // All diffs together fit in one prompt
    const diff = truncate(await git(repoDir, 'diff', `HEAD...${branch}`), Math.floor(90_000 / branches.length));
    changes += `\n\nBRANCH ${branch}\n\n${diff}`;
  }
  return changes;
}

// Why your checkout can't take a merge into `into` right now, or null if it can
export async function checkoutProblem(repoDir: string, into: string): Promise<string | null> {
  const current = (await git(repoDir, 'rev-parse', '--abbrev-ref', 'HEAD')).trim();
  if (current !== into) return `you're on ${current}, but it merges into ${into}: switch back to ${into}`;
  if ((await git(repoDir, 'status', '--porcelain', '--untracked-files=no')).trim()) {
    return `you have uncommitted changes on ${into}: commit or stash them`;
  }
  return null;
}

// Brings a branch into `into`, rebased and fast-forwarded, see rebase.ts. Returns null when it's in, else why not.
export async function mergeBranch(repoDir: string, branch: string, into: string): Promise<string | null> {
  const problem = await checkoutProblem(repoDir, into);
  if (problem) return problem;
  const { result } = await rebaseAndFastForward(repoDir, branch, (cwd, args) => exec(cwd, 'git', args, { quiet: true }));
  if (result === 'conflict') return `it conflicts with ${into}`;
  if (result === 'not fast-forward') return `${into} couldn't be fast-forwarded to it`;
  return null;
}

// The cases of every skill that has a skill-loaded-evals.json, each with the name of its skill
export async function listSkillLoadedEvalCases(repoDir: string): Promise<SkillLoadedEvalCase[]> {
  const skillsDir = path.join(repoDir, '.agents/skills');
  const cases: SkillLoadedEvalCase[] = [];
  for (const skill of (await readdir(skillsDir)).sort()) {
    const file = path.join(skillsDir, skill, 'skill-loaded-evals.json');
    if (!existsSync(file)) continue;
    const skillCases: { prompt: string; loads: boolean }[] = JSON.parse(await readFile(file, 'utf8'));
    cases.push(...skillCases.map(({ prompt, loads }) => ({ skill, prompt, loads })));
  }
  return cases;
}
