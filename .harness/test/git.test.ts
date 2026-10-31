import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { MockActivityEnvironment } from '@temporalio/testing';
import { addWorktree, changesSince, mergeBranch, removeWorktree, requireCommitted } from '../src/activities/git';
import type { Changes } from '../src/types/pipeline';

// The git activities on a real repository: two loops' branches, the way the implement loops leave them
function repo(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rebase-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  writeFileSync(path.join(dir, '.gitignore'), '.harness/worktrees/\n');
  git('add', '.');
  git('commit', '-qm', 'Start');
  for (const [task, file, text] of [['task-5', 'b.txt', 'five'], ['task-6', 'c.txt', 'six'], ['task-7', 'b.txt', 'seven']]) {
    const worktree = path.join(dir, '.harness/worktrees', task);
    git('worktree', 'add', '-q', '-b', `agent/${task}`, worktree, 'main');
    writeFileSync(path.join(worktree, file), `${text}\n`);
    execFileSync('git', ['add', '.'], { cwd: worktree });
    execFileSync('git', ['commit', '-qm', `Build ${task}`], { cwd: worktree });
  }
  return dir;
}

const run = (dir: string, ...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

test('the pipeline rebases the branches one after the other, without merge commits, and leaves out a conflict', async () => {
  const dir = repo();
  const env = new MockActivityEnvironment();
  assert.equal(await env.run(mergeBranch, dir, 'agent/task-5', 'main'), null);
  assert.equal(await env.run(mergeBranch, dir, 'agent/task-6', 'main'), null);
  assert.equal(await env.run(mergeBranch, dir, 'agent/task-7', 'main'), 'it conflicts with main'); // b.txt, like task-5
  assert.equal(run(dir, 'log', '--format=%s'), 'Build task-6\nBuild task-5\nStart');
  assert.equal(run(dir, 'rev-list', '--merges', 'HEAD'), '');
  assert.equal(run(dir, 'status', '--porcelain'), '');
  assert.equal(run(path.join(dir, '.harness/worktrees/task-7'), 'status', '--porcelain'), '');
  assert.equal(await env.run(mergeBranch, dir, 'agent/task-6', 'main'), null); // a retry finds it already in
});

test('it only merges into the branch you started on, and not over your uncommitted changes', async () => {
  const dir = repo();
  const env = new MockActivityEnvironment();
  writeFileSync(path.join(dir, 'a.txt'), 'yours, not committed\n');
  assert.match(String(await env.run(mergeBranch, dir, 'agent/task-5', 'main')), /uncommitted changes on main/);
  run(dir, 'checkout', '-q', 'a.txt');
  run(dir, 'checkout', '-qb', 'other');
  assert.match(String(await env.run(mergeBranch, dir, 'agent/task-5', 'main')), /you're on other, but it merges into main/);
  assert.equal(run(dir, 'log', '--format=%s', 'main'), 'Start');
});

test('the loops all add to learnings.md, and both their lines get in', async () => {
  const dir = repo();
  writeFileSync(path.join(dir, '.gitattributes'), '.harness/learnings.md merge=union\n');
  mkdirSync(path.join(dir, '.harness'), { recursive: true });
  writeFileSync(path.join(dir, '.harness/learnings.md'), '# Learnings\n');
  run(dir, 'add', '.');
  run(dir, 'commit', '-qm', 'Learnings');
  for (const task of ['task-8', 'task-9']) {
    const worktree = path.join(dir, '.harness/worktrees', task);
    run(dir, 'worktree', 'add', '-q', '-b', `agent/${task}`, worktree, 'main');
    appendFileSync(path.join(worktree, '.harness/learnings.md'), `- learned in ${task}\n`);
    run(worktree, 'commit', '-qam', `Learn in ${task}`);
  }
  const env = new MockActivityEnvironment();
  assert.equal(await env.run(mergeBranch, dir, 'agent/task-8', 'main'), null);
  assert.equal(await env.run(mergeBranch, dir, 'agent/task-9', 'main'), null);
  assert.equal(run(dir, 'show', 'HEAD:.harness/learnings.md'), '# Learnings\n- learned in task-8\n- learned in task-9');
});

test('once its branch is in, the worktree and the branch go, and a retry does nothing', async () => {
  const dir = repo();
  const env = new MockActivityEnvironment();
  assert.equal(await env.run(mergeBranch, dir, 'agent/task-5', 'main'), null);
  await env.run(removeWorktree, dir, 'task-5', 'agent/task-5');
  assert.equal(existsSync(path.join(dir, '.harness/worktrees/task-5')), false);
  assert.equal(run(dir, 'branch', '--list', 'agent/task-5'), '');
  await env.run(removeWorktree, dir, 'task-5', 'agent/task-5');
});

test('a fresh loop doesn’t take over a branch an earlier run left, a loop on its own goes on with it', async () => {
  const dir = repo();
  const head = run(dir, 'rev-parse', 'HEAD');
  const env = new MockActivityEnvironment();
  // A retry of the activity: the branch is there, but nothing happened on it yet
  const fresh = await env.run(addWorktree, dir, 'task-8', 'agent/task-8', head, true);
  assert.equal(await env.run(addWorktree, dir, 'task-8', 'agent/task-8', head, true), fresh);
  // agent/task-5 has a commit from an earlier run
  await assert.rejects(env.run(addWorktree, dir, 'task-5', 'agent/task-5', head, true), /agent\/task-5 is left over from an earlier run/);
  // `flows ralph` goes on with it, also once its worktree is gone
  run(dir, 'worktree', 'remove', '--force', '.harness/worktrees/task-5');
  const goesOn: string = await env.run(addWorktree, dir, 'task-5', 'agent/task-5', head);
  assert.equal(run(goesOn, 'log', '-1', '--format=%s'), 'Build task-5');
});

test('what changed since a commit: the commits, and what is left uncommitted', async () => {
  const dir = repo();
  const worktree = path.join(dir, '.harness/worktrees/task-5');
  const before = run(worktree, 'rev-parse', 'HEAD');
  const env = new MockActivityEnvironment();
  assert.deepEqual(await env.run(changesSince, worktree, before), { files: [], uncommitted: [], commits: '' });
  writeFileSync(path.join(worktree, 'd.txt'), 'step\n');
  run(worktree, 'add', '.');
  run(worktree, 'commit', '-qm', 'Do a step');
  writeFileSync(path.join(worktree, 'e.txt'), 'forgotten\n');
  const changes: Changes = await env.run(changesSince, worktree, before);
  assert.deepEqual(changes.files, ['d.txt']);
  assert.deepEqual(changes.uncommitted, ['e.txt']);
  assert.match(changes.commits, /Do a step[\s\S]*\+step/);
});

test('a file the agents need has to be committed, a worktree has nothing else', async () => {
  const dir = repo();
  writeFileSync(path.join(dir, 'spec.md'), 'not committed\n');
  const env = new MockActivityEnvironment();
  await env.run(requireCommitted, dir, 'a.txt');
  await assert.rejects(env.run(requireCommitted, dir, 'spec.md'), /spec\.md isn't committed/);
  // A skill you edited, but didn't commit: the agents wouldn't see your edit
  writeFileSync(path.join(dir, 'a.txt'), 'edited\n');
  await assert.rejects(env.run(requireCommitted, dir, 'a.txt'), /a\.txt has changes you didn't commit/);
});
