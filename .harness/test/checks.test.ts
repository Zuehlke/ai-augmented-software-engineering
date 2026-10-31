import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { MockActivityEnvironment } from '@temporalio/testing';
import { designProblem as designProblemActivity, specificationOf as specificationOfActivity } from '../src/activities/checks';

// Activities run git through the activity context: the mock gives them one
const env = new MockActivityEnvironment();
const specificationOf = (dir: string, before: string, revising?: string): ReturnType<typeof specificationOfActivity> => env.run(specificationOfActivity, dir, before, revising) as never;
const designProblem = (dir: string, before: string, spec: string): ReturnType<typeof designProblemActivity> => env.run(designProblemActivity, dir, before, spec) as never;

// A repository with one specification from earlier work, and what an agent commits on top of it
function repo(): { dir: string; base: string; commit: (files: Record<string, string>) => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'spec-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  const commit = (files: Record<string, string>) => {
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), text);
    }
    git('add', '.');
    git('commit', '-qm', 'work');
  };
  commit({ 'specs/old-feature/specification.md': '# Old\n' });
  return { dir, base: git('rev-parse', 'HEAD'), commit };
}

test('research writes one new specification: the pipeline names it from then on', async () => {
  const r = repo();
  r.commit({ 'specs/delays/specification.md': '# Delays\n' });
  assert.deepEqual(await specificationOf(r.dir, r.base), { spec: 'specs/delays/specification.md' });
});

test('research that changed an earlier specification, wrote two, none, or changed code is sent back', async () => {
  const earlier = repo();
  earlier.commit({ 'specs/old-feature/specification.md': '# Old, changed\n' });
  assert.match((await specificationOf(earlier.dir, earlier.base)).problem ?? '', /was already there, from earlier work/);
  const two = repo();
  two.commit({ 'specs/a/specification.md': 'a', 'specs/b/specification.md': 'b' });
  assert.match((await specificationOf(two.dir, two.base)).problem ?? '', /more than one specification/);
  const none = repo();
  none.commit({ 'specs/delays/notes.md': 'notes' });
  assert.match((await specificationOf(none.dir, none.base)).problem ?? '', /didn't write the specification/);
  const code = repo();
  code.commit({ 'specs/delays/specification.md': '# Delays\n', 'src/Main.java': 'class Main {}' });
  assert.match((await specificationOf(code.dir, code.base)).problem ?? '', /changes no code/);
});

test('sent back, research revises the specification it wrote, and no other', async () => {
  const r = repo();
  r.commit({ 'specs/old-feature/specification.md': '# Old, revised\n' });
  assert.deepEqual(await specificationOf(r.dir, r.base, 'specs/old-feature/specification.md'), { spec: 'specs/old-feature/specification.md' });
  assert.match((await specificationOf(r.dir, r.base, 'specs/delays/specification.md')).problem ?? '', /revise specs\/delays\/specification\.md, not specs\/old-feature/);
});

test('the design goes next to the specification it was named, and nowhere else', async () => {
  const r = repo();
  r.commit({ 'specs/delays/design.md': '# Design\n' });
  assert.equal(await designProblem(r.dir, r.base, 'specs/delays/specification.md'), null);
  assert.match((await designProblem(r.dir, r.base, 'specs/other/specification.md')) ?? '', /the design goes into specs\/other\/design\.md only/);
});
