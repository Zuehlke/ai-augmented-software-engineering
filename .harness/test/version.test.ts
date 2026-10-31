import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { noteWorkerVersion, staleWorker } from '../src/lib/worker-version';

// A repository with .harness/src, and a state folder for the worker's note
function repo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'flows-version-'));
  process.env.FLOWS_STATE = path.join(dir, 'state');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, stdio: 'ignore' });
  git('init', '--quiet');
  mkdirSync(path.join(dir, '.harness/src'), { recursive: true });
  const write = (text: string) => writeFileSync(path.join(dir, '.harness/src/a.ts'), text);
  const commit = (text: string) => {
    write(text);
    git('add', '.');
    git('commit', '--quiet', '-m', text);
  };
  commit('one');
  return { dir, write, commit, git };
}

test('a worker that runs the committed harness is not stale', () => {
  const { dir } = repo();
  noteWorkerVersion(dir);
  assert.equal(staleWorker(dir), null);
});

test('a worker that started before the last commit is stale, until it restarts', () => {
  const { dir, commit } = repo();
  noteWorkerVersion(dir);
  commit('two');
  assert.match(staleWorker(dir) ?? '', /\(a\.ts differ\)/);
  noteWorkerVersion(dir);
  assert.equal(staleWorker(dir), null);
});

test('a worker that runs uncommitted code is stale, but not once that code is committed, with no restart', () => {
  const { dir, write, git } = repo();
  write('edited');
  noteWorkerVersion(dir);
  assert.match(staleWorker(dir) ?? '', /\(a\.ts differ\)/);
  git('add', '.');
  git('commit', '--quiet', '-m', 'edited');
  assert.equal(staleWorker(dir), null);
});

test('a new file the worker runs counts too', () => {
  const { dir } = repo();
  writeFileSync(path.join(dir, '.harness/src/b.ts'), 'new');
  noteWorkerVersion(dir);
  assert.match(staleWorker(dir) ?? '', /\(b\.ts differ\)/);
});

test('without a note from a worker there is nothing to compare', () => {
  const { dir } = repo();
  assert.equal(staleWorker(dir), null);
});
