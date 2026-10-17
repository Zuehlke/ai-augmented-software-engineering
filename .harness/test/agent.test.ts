import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { MockActivityEnvironment } from '@temporalio/testing';
import { parseStream, readable, runAgent } from '../src/activities/agent';
import type { AgentInput } from '../src/types/agent';

// What claude -p --output-format stream-json --verbose prints, cut down to the fields the harness reads
const INIT = JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-opus-5-5', session_id: 's' });
const ASSISTANT = JSON.stringify({
  type: 'assistant',
  message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Reading it.' }, { type: 'tool_use', name: 'Read', input: { file_path: 'src/Flights.java' } }] },
});
const RESULT = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  num_turns: 3,
  result: 'Looks good.\nPASS',
  total_cost_usd: 0.4213,
  modelUsage: { 'claude-haiku-5-5': { costUSD: 0.0012 }, 'claude-opus-5-5': { costUSD: 0.4201 } },
});

// A repository with the sandbox settings, and a fake agent that prints `output` whatever it's asked
function setUp(command: string, output: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agent-'));
  mkdirSync(path.join(dir, '.harness/sandbox'), { recursive: true });
  writeFileSync(path.join(dir, '.harness/sandbox/no-network.json'), '{}');
  mkdirSync(path.join(dir, 'bin'));
  writeFileSync(path.join(dir, 'output'), output);
  writeFileSync(path.join(dir, 'bin', command), `#!/bin/sh\ncat "${path.join(dir, 'output')}"\n`);
  chmodSync(path.join(dir, 'bin', command), 0o755);
  return dir;
}

async function withPath<T>(dir: string, work: () => Promise<T>): Promise<T> {
  const pathBefore = process.env.PATH;
  process.env.PATH = `${path.join(dir, 'bin')}:${pathBefore}`;
  try {
    return await work();
  } finally {
    process.env.PATH = pathBefore;
  }
}

test('the worker’s log says which step runs, and shows the agent’s text and tool calls instead of JSON', async (t) => {
  const dir = setUp('claude', [INIT, ASSISTANT, RESULT].join('\n') + '\n');
  const lines: string[] = [];
  t.mock.method(console, 'log', (line: string) => void lines.push(line));
  await withPath(dir, async () => {
    const env = new MockActivityEnvironment();
    await env.run(runAgent, { repoDir: dir, agent: 'claude', mode: 'read', prompt: 'p', step: 'judge research' } satisfies AgentInput);
    await env.run(runAgent, { repoDir: dir, agent: 'claude', mode: 'read', prompt: 'p', step: 'plan' } satisfies AgentInput);
  });
  const logged = lines.filter((line) => line.includes(' == '));
  assert.match(logged[0], /\] == judge research: claude$/);
  assert.match(logged[2], /\] == plan: claude$/);
  const shown = lines.map((line) => line.replace(/^\[[^\]]+\] /, ''));
  assert.deepEqual(shown.slice(1, 5), ['Reading it.', '→ Read src/Flights.java', '== 3 turns, $0.42', '== plan: claude']);
  assert.ok(!lines.some((line) => line.includes('{"type"')));
});

test('a claude run gives back its answer, its cost and the model its family resolved to', async () => {
  const dir = setUp('claude', [INIT, ASSISTANT, RESULT].join('\n') + '\n');
  const run = await withPath(dir, () => new MockActivityEnvironment().run(runAgent, { repoDir: dir, agent: 'claude', mode: 'read', model: 'opus', prompt: 'p' } satisfies AgentInput));
  assert.deepEqual(run, { output: 'Looks good.\nPASS', costUsd: 0.4213, model: 'claude-opus-5-5' });
});

test('a copilot run gives back only its answer: Copilot reports no cost', async () => {
  const dir = setUp('copilot', 'Looks good.\nPASS\n');
  const run = await withPath(dir, () => new MockActivityEnvironment().run(runAgent, { repoDir: dir, agent: 'copilot', mode: 'read', prompt: 'p' } satisfies AgentInput));
  assert.deepEqual(run, { output: 'Looks good.\nPASS\n' });
});

test('a claude run without a result event is retried', async () => {
  const dir = setUp('claude', INIT + '\n');
  await assert.rejects(
    withPath(dir, () => new MockActivityEnvironment().run(runAgent, { repoDir: dir, agent: 'claude', mode: 'read', prompt: 'p' } satisfies AgentInput)),
    /claude stopped without a result/,
  );
});

test('when a long run’s output lost the init event, the model is the one that cost the most', () => {
  assert.equal(parseStream(`${RESULT.slice(10)}\n${ASSISTANT}\n${RESULT}\n`)?.model, 'claude-opus-5-5');
  assert.equal(parseStream(ASSISTANT), undefined);
});

test('the log shows nothing for events without text, and plain lines as they are', () => {
  assert.equal(readable(INIT), undefined);
  assert.equal(readable('Warning: something'), 'Warning: something');
  assert.equal(readable(''), undefined);
});
