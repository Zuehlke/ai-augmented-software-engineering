import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { blockedTasks, readyTasks } from '../src/activities/backlog';

// A repository with these tasks in backlog/, each `[id, front matter]`
function repo(tasks: [string, string][]): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'backlog-'));
  mkdirSync(path.join(dir, 'backlog'));
  for (const [id, front] of tasks) writeFileSync(path.join(dir, 'backlog', `${id}-slug.md`), `---\nid: ${id}\n${front}\n---\n\n# ${id}\n`);
  return dir;
}

test('a task blocked only by tasks can start once they are all done, one that also waits for something else can’t', async () => {
  const dir = repo([
    ['TASK-1', 'status: done'],
    ['TASK-2', 'status: ready'],
    ['TASK-3', 'status: blocked\nblocked_by: TASK-1'],
    ['TASK-4', 'status: blocked\nblocked_by: TASK-1, TASK-2'],
    ['TASK-5', 'status: blocked\nblocked_by: TASK-1\nblocked_reason: the airport dataset from the data team'],
    ['TASK-6', 'status: blocked\nblocked_reason: blocked until TASK-1 lands'], // no blocked_by: nobody knows for sure
  ]);
  assert.deepEqual(await readyTasks(dir), ['TASK-2', 'TASK-3']);
  assert.deepEqual(await blockedTasks(dir, ['TASK-2']), ["TASK-4: still blocked, TASK-2 isn't done"]);
  assert.deepEqual(await blockedTasks(dir, ['TASK-1']), [
    "TASK-4: still blocked, TASK-2 isn't done",
    'TASK-5: still blocked, the airport dataset from the data team',
  ]);
});
