// Bringing the branch of a finished `flows ralph` loop into yours from the board, by rebase. Only a pipeline merges by itself.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rebaseAndFastForward } from '../rebase';
import { branchOf, worktreeName } from '../shared';

// What you need to know before merging the branch into the one you're on
export interface MergePreview {
  ticket: string;
  title: string;
  branch: string;
  commits: string[]; // the ones the branch you're on doesn't have, oldest first
  stat: string; // for example "4 files changed, 62 insertions(+), 1 deletion(-)"
  conflicts: boolean;
  uncommitted: string[]; // what the loop left in its worktree without committing, not on the branch
}

const git = (repoDir: string, ...args: string[]) => execFileSync('git', args, { cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

export function previewMerge(repoDir: string, ticket: string, title: string): MergePreview {
  const branch = branchOf(ticket);
  const commits = git(repoDir, 'log', '--reverse', '--format=%s', `HEAD..${branch}`).split('\n').filter(Boolean);
  const stat = git(repoDir, 'diff', '--shortstat', `HEAD...${branch}`).trim();
  let conflicts = false;
  try {
    git(repoDir, 'merge-tree', '--write-tree', 'HEAD', branch); // merges in memory, exits with 1 on conflicts
  } catch {
    conflicts = true;
  }
  let uncommitted: string[] = [];
  try {
    const status = git(path.join(repoDir, '.harness/worktrees', worktreeName(ticket)), 'status', '--porcelain');
    uncommitted = status.split('\n').filter(Boolean).map((line) => line.slice(3));
  } catch {
    // no worktree anymore
  }
  return { ticket, title, branch, commits, stat, conflicts, uncommitted };
}

// At most this many diffs open at once, so a big branch doesn't flood the IDE with tabs
const MAX_DIFFS = 20;

// Opens what the branch brings in the IDE (VS Code's `code`), one side-by-side diff per file: on the left
// as it was where the branch split off, on the right as the branch has it. Says what it did.
export function openDiff(repoDir: string, branch: string, code = 'code'): string {
  const base = git(repoDir, 'merge-base', 'HEAD', branch).trim();
  const changes = git(repoDir, 'diff', '--name-status', '--no-renames', base, branch).split('\n').filter(Boolean).map((line) => line.split('\t'));
  if (!changes.length) return `${branch} changes nothing.`;
  const dir = mkdtempSync(path.join(os.tmpdir(), `flows-diff-${branch.replace(/\//g, '-')}-`));
  // A file as it is in a commit, empty where it doesn't exist (added or deleted)
  const side = (name: string, rev: string, file: string, exists: boolean) => {
    const target = path.join(dir, name, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, exists ? execFileSync('git', ['show', `${rev}:${file}`], { cwd: repoDir, stdio: ['ignore', 'pipe', 'ignore'] }) : '');
    return target;
  };
  try {
    for (const [status, file] of changes.slice(0, MAX_DIFFS)) {
      const before = side('before', base, file, status !== 'A');
      const after = side('after', branch, file, status !== 'D');
      execFileSync(code, ['--reuse-window', '--diff', before, after], { stdio: 'ignore', timeout: 10_000 });
    }
  } catch {
    return `Couldn't open the IDE, is \`${code}\` on the PATH? In a terminal: git diff HEAD...${branch}`;
  }
  const more = changes.length > MAX_DIFFS ? `, the first ${MAX_DIFFS} of ${changes.length}` : '';
  return `Opened the diff of ${changes.length === 1 ? '1 file' : `${changes.length} files`} in the IDE${more}.`;
}

// m, then y on the board: rebases the branch onto the one you're on and fast-forwards that, see rebase.ts.
// Then removes the loop's worktree and branch. Says what it did, or how to do it by hand.
export async function mergeIntoYours(repoDir: string, branch: string): Promise<string> {
  const into = git(repoDir, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
  const { result, worktree } = await rebaseAndFastForward(repoDir, branch);
  if (result === 'conflict') {
    const byHand = worktree ? `git -C ${path.relative(repoDir, worktree) || '.'} rebase ${into}` : `git rebase ${into} ${branch}`;
    return `Couldn't rebase ${branch} onto ${into}, nothing changed. Do it by hand: ${byHand}`;
  }
  if (result === 'not fast-forward') {
    return `Rebased ${branch}, but couldn't fast-forward ${into}, maybe your uncommitted changes are in the way: git merge --ff-only ${branch}`;
  }
  // The loop's worktree and branch are done with, so a later loop on the ticket starts fresh
  try {
    if (worktree) git(repoDir, 'worktree', 'remove', worktree);
    git(repoDir, 'branch', '-d', branch);
  } catch {
    return `Rebased ${branch} onto ${into} and fast-forwarded it, but kept its worktree: it has changes the loop didn't commit. Run the tests: task test`;
  }
  return `Rebased ${branch} onto ${into} and fast-forwarded it, and removed the branch. Run the tests: task test`;
}

// x, then y on the board: throws a loop's work away, so the next loop on the ticket starts fresh. Removes its
// worktree, uncommitted changes and all, and deletes its branch, merged or not. Says what it did.
export function discardBranch(repoDir: string, ticket: string): string {
  const branch = branchOf(ticket);
  const worktree = path.join(repoDir, '.harness/worktrees', worktreeName(ticket));
  const removed: string[] = [];
  if (existsSync(worktree)) {
    git(repoDir, 'worktree', 'remove', '--force', worktree);
    removed.push(path.relative(repoDir, worktree));
  }
  if (git(repoDir, 'branch', '--list', branch).trim()) {
    git(repoDir, 'branch', '-D', branch);
    removed.push(branch);
  }
  return removed.length ? `Threw away ${removed.join(' and ')}.` : `${ticket} has no worktree or branch.`;
}
