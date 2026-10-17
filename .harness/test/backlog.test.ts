import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { blockedTickets, readyTickets } from '../src/activities/repo';

// A repository with these tickets in backlog/, each `[id, front matter]`
function repo(tickets: [string, string][]): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'backlog-'));
  mkdirSync(path.join(dir, 'backlog'));
  for (const [id, front] of tickets) writeFileSync(path.join(dir, 'backlog', `${id}-slug.md`), `---\nid: ${id}\n${front}\n---\n\n# ${id}\n`);
  return dir;
}

test('a ticket blocked only by tickets can start once they are all done, one that also waits for something else can’t', async () => {
  const dir = repo([
    ['TICKET-1', 'status: done'],
    ['TICKET-2', 'status: ready'],
    ['TICKET-3', 'status: blocked\nblocked_by: TICKET-1'],
    ['TICKET-4', 'status: blocked\nblocked_by: TICKET-1, TICKET-2'],
    ['TICKET-5', 'status: blocked\nblocked_by: TICKET-1\nblocked_reason: the airport dataset from the data team'],
    ['TICKET-6', 'status: blocked\nblocked_reason: blocked until TICKET-1 lands'], // no blocked_by: nobody knows for sure
  ]);
  assert.deepEqual(await readyTickets(dir), ['TICKET-2', 'TICKET-3']);
  assert.deepEqual(await blockedTickets(dir, ['TICKET-2']), ["TICKET-4: still blocked, TICKET-2 isn't done"]);
  assert.deepEqual(await blockedTickets(dir, ['TICKET-1']), [
    "TICKET-4: still blocked, TICKET-2 isn't done",
    'TICKET-5: still blocked, the airport dataset from the data team',
  ]);
});
