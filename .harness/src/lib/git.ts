// Bringing an agent's branch into yours, for the pipeline's merge step and for `flows watch`
import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Runs git in a directory and never throws: the exit code says whether it worked
export type Git = (cwd: string, args: string[]) => Promise<{ code: number; output: string }>;

const plainGit: Git = (cwd, args) =>
  new Promise((resolve) => {
    execFile('git', args, { cwd, encoding: 'utf8' }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, output: stdout + stderr });
    });
  });

export interface RebaseResult {
  result: 'merged' | 'conflict' | 'not fast-forward';
  worktree?: string; // the loop's worktree, where the branch is checked out, if it still exists
}

// Rebases the branch onto the branch repoDir is on, then fast-forwards that: a straight history, no
// merge commit. The branch is checked out in its loop's worktree, so it rebases there, or in a
// temporary one if that's gone. On a conflict nothing changes. A branch that's already in is `merged`.
// The activity passes its own `git`, which heartbeats and shows up in the worker's log.
export async function rebaseAndFastForward(repoDir: string, branch: string, git: Git = plainGit): Promise<RebaseResult> {
  if ((await git(repoDir, ['merge-base', '--is-ancestor', branch, 'HEAD'])).code === 0) {
    return { result: 'merged' }; // already in, for example by an earlier attempt
  }
  const head = (await git(repoDir, ['rev-parse', 'HEAD'])).output.trim();
  const worktrees = (await git(repoDir, ['worktree', 'list', '--porcelain'])).output;
  const worktree = [...worktrees.matchAll(/^worktree (.+)\nHEAD .+\nbranch (.+)$/gm)].find((m) => m[2] === `refs/heads/${branch}`)?.[1];
  const dir = worktree ?? path.join(await mkdtemp(path.join(os.tmpdir(), 'flows-rebase-')), 'worktree');
  try {
    if (!worktree && (await git(repoDir, ['worktree', 'add', dir, branch])).code !== 0) {
      throw new Error(`Couldn't check out ${branch} in a temporary worktree`);
    }
    // Clears a rebase that an interrupted earlier attempt left half done. Fails harmlessly if there is none.
    await git(dir, ['rebase', '--abort']);
    if ((await git(dir, ['rebase', head])).code !== 0) {
      await git(dir, ['rebase', '--abort']);
      return { result: 'conflict', worktree };
    }
    const fastForward = await git(repoDir, ['merge', '--ff-only', branch]);
    return { result: fastForward.code === 0 ? 'merged' : 'not fast-forward', worktree };
  } finally {
    if (!worktree) await git(repoDir, ['worktree', 'remove', '--force', dir]);
  }
}
