import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { ApplicationFailure } from '@temporalio/common';
import { rebaseAndFastForward } from '../lib/git';
import type { Changes } from '../types/pipeline';
import { exec, git } from './exec';

// Activities on git: the worktrees the agents work in, what they changed, and bringing a branch into yours.
// Every activity has to be safe to run twice: Temporal retries it when it fails or its worker dies.

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
  // git lists a worktree by its real path: on macOS, for example, /var is a link to /private/var
  const listed = await git(repoDir, 'worktree', 'list', '--porcelain');
  const real = existsSync(dir) ? realpathSync(dir) : dir;
  if (!listed.includes(`worktree ${dir}\n`) && !listed.includes(`worktree ${real}\n`)) {
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

// Brings a branch into `into`, rebased and fast-forwarded, see lib/git.ts. Returns null when it's in, else why not.
export async function mergeBranch(repoDir: string, branch: string, into: string): Promise<string | null> {
  const problem = await checkoutProblem(repoDir, into);
  if (problem) return problem;
  const { result } = await rebaseAndFastForward(repoDir, branch, (cwd, args) => exec(cwd, 'git', args, { quiet: true }));
  if (result === 'conflict') return `it conflicts with ${into}`;
  if (result === 'not fast-forward') return `${into} couldn't be fast-forwarded to it`;
  return null;
}
