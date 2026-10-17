import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { discardBranch, mergeIntoYours, openDiff, previewMerge } from '../src/watch/merge';

// A repository on main with the branch agent/ticket-5, the way a `flows ralph` loop leaves it
function repo(conflicting = false): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'merge-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  git('add', '.');
  git('commit', '-qm', 'Start');
  git('checkout', '-qb', 'agent/ticket-5');
  writeFileSync(path.join(dir, 'a.txt'), 'two\n');
  git('commit', '-qam', 'Change a');
  git('checkout', '-q', 'main');
  if (conflicting) {
    writeFileSync(path.join(dir, 'a.txt'), 'three\n');
    git('commit', '-qam', 'Change a too');
  }
  return dir;
}

const run = (dir: string, ...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();

test('the preview shows what the branch brings, then it rebases onto main without a merge commit', async () => {
  const dir = repo();
  writeFileSync(path.join(dir, 'b.txt'), 'main moved on\n');
  run(dir, 'add', '.');
  run(dir, 'commit', '-qm', 'Main moves on');
  const preview = previewMerge(dir, 'TICKET-5', 'Hello world page');
  assert.deepEqual(preview.commits, ['Change a']);
  assert.equal(preview.conflicts, false);
  assert.match(await mergeIntoYours(dir, preview.branch), /^Rebased agent\/ticket-5 onto main/);
  assert.equal(run(dir, 'log', '--format=%s'), 'Change a\nMain moves on\nStart');
  assert.equal(run(dir, 'rev-list', '--merges', 'HEAD'), '');
  assert.equal(run(dir, 'branch', '--list', 'agent/ticket-5'), ''); // it's in, so the branch goes
});

test('a branch checked out in the loop’s worktree rebases there, then the worktree and the branch go', async () => {
  const dir = repo();
  writeFileSync(path.join(dir, 'b.txt'), 'main moved on\n');
  run(dir, 'add', '.');
  run(dir, 'commit', '-qm', 'Main moves on');
  run(dir, 'worktree', 'add', '-q', '.harness/worktrees/ticket-5', 'agent/ticket-5');
  assert.match(await mergeIntoYours(dir, 'agent/ticket-5'), /^Rebased .* and removed the branch/);
  assert.equal(run(dir, 'log', '--format=%s'), 'Change a\nMain moves on\nStart');
  assert.equal(existsSync(path.join(dir, '.harness/worktrees/ticket-5')), false);
  assert.equal(run(dir, 'branch', '--list', 'agent/ticket-5'), '');
});

test('a conflict shows in the preview, and rebasing changes nothing', async () => {
  const dir = repo(true);
  assert.equal(previewMerge(dir, 'TICKET-5', 'Hello world page').conflicts, true);
  const head = run(dir, 'rev-parse', 'HEAD');
  const branch = run(dir, 'rev-parse', 'agent/ticket-5');
  assert.match(await mergeIntoYours(dir, 'agent/ticket-5'), /^Couldn't rebase/);
  assert.equal(run(dir, 'rev-parse', 'HEAD'), head);
  assert.equal(run(dir, 'rev-parse', 'agent/ticket-5'), branch);
  assert.equal(run(dir, 'status', '--porcelain'), '');
  assert.equal(run(dir, 'worktree', 'list').split('\n').length, 1); // the temporary worktree is gone
});

test('the diff opens in the IDE, one side-by-side diff per file the branch changes', () => {
  const dir = repo();
  run(dir, 'checkout', '-q', 'agent/ticket-5');
  writeFileSync(path.join(dir, 'new.txt'), 'new\n');
  run(dir, 'add', '.');
  run(dir, 'commit', '-qm', 'Add new');
  run(dir, 'checkout', '-q', 'main');
  // A fake `code` that writes down the files it was asked to compare
  const calls = path.join(dir, 'calls.txt');
  const code = path.join(dir, 'code');
  writeFileSync(code, `#!/bin/sh\nshift 2\nprintf '%s|%s\\n' "$1" "$2" >> ${calls}\n`);
  chmodSync(code, 0o755);
  assert.equal(openDiff(dir, 'agent/ticket-5', code), 'Opened the diff of 2 files in the IDE.');
  const pairs = readFileSync(calls, 'utf8').trim().split('\n').map((line) => line.split('|').map((file) => readFileSync(file, 'utf8')));
  assert.deepEqual(pairs, [['one\n', 'two\n'], ['', 'new\n']]);
  assert.match(openDiff(dir, 'agent/ticket-5', 'no-such-ide'), /^Couldn't open the IDE/);
});

test('throwing a loop away removes its worktree, uncommitted changes and all, and its unmerged branch', () => {
  const dir = repo();
  run(dir, 'worktree', 'add', '-q', '.harness/worktrees/ticket-5', 'agent/ticket-5');
  writeFileSync(path.join(dir, '.harness/worktrees/ticket-5/c.txt'), 'not committed\n');
  assert.equal(discardBranch(dir, 'TICKET-5'), 'Threw away .harness/worktrees/ticket-5 and agent/ticket-5.');
  assert.equal(existsSync(path.join(dir, '.harness/worktrees/ticket-5')), false);
  assert.equal(run(dir, 'branch', '--list', 'agent/ticket-5'), '');
  assert.equal(run(dir, 'log', '--format=%s'), 'Start'); // your branch stays as it was
  assert.equal(discardBranch(dir, 'TICKET-5'), 'TICKET-5 has no worktree or branch.');
});
