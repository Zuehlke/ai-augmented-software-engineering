import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { WorkflowFailedError } from '@temporalio/client';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { DefaultLogger, Runtime, Worker } from '@temporalio/worker';
import type * as activities from '../src/activities';
import { answers } from './fakes';
import type { AgentInput } from '../src/types/agent';
import type { RalphResult } from '../src/types/pipeline';
import { answerSignal, ralphStatus } from '../src/workflows/signals';
import { findVerdict, parseVerdict } from '../src/workflows/support/text';

// The ralph workflow with fake activities: no agent, no git, no tests, just the loop's logic

let env: TestWorkflowEnvironment;
before(async () => {
  Runtime.install({ logger: new DefaultLogger('WARN') });
  env = await TestWorkflowEnvironment.createLocal();
});
after(async () => {
  await env?.teardown();
});

async function createWorker(fakes: Partial<typeof activities>): Promise<Worker> {
  return Worker.create({
    connection: env.nativeConnection,
    taskQueue: 'test',
    workflowsPath: require.resolve('../src/workflows'),
    activities: {
      headCommit: async () => 'abc123',
      addWorktree: async (repo: string, name: string) => `${repo}/.harness/worktrees/${name}`,
      requireCommitted: async () => {},
      setFeedback: async () => {},
      changesSince: async () => ({ files: ['src/Flights.java'], uncommitted: [], commits: 'commit' }), // the agent committed a step
      resetTo: async () => {},
      runTests: async () => ({ pass: true, tail: '' }),
      taskDone: async () => false,
      progressLeft: async () => false,
      ...fakes,
    },
  });
}

// Whether the task is done
async function runRalph(fakes: Partial<typeof activities>, maxRuns?: number): Promise<boolean> {
  const worker = await createWorker(fakes);
  const result: RalphResult = await worker.runUntil(
    env.client.workflow.execute('ralph', {
      taskQueue: 'test',
      workflowId: `ralph-test-${Math.random()}`,
      args: [{ repoDir: '/repo', agent: 'claude', task: 'TASK-1', maxRuns }],
    }),
  );
  return result.done;
}

test('a rejected step becomes the feedback for the next run', async () => {
  const feedback: (string | null)[] = [];
  let judged = 0;
  let done = false;
  const result = await runRalph({
    setFeedback: async (_dir: string, text: string | null) => void feedback.push(text),
    runAgent: answers(async ({ mode }: AgentInput) => {
      if (mode === 'write') return 'did a step';
      judged++;
      if (judged === 1) return 'RETRYABLE: add a test';
      done = true;
      return 'Looks good.\nPASS';
    }),
    taskDone: async () => done,
  });

  assert.equal(result, true);
  assert.deepEqual(feedback, [null, 'The judge rejected your work: add a test', null]); // null at the end: removed after the phase
});

test('failing tests skip the judge agent, and the loop gives up after 3 failed runs in a row', async () => {
  const modes: string[] = [];
  await assert.rejects(
    runRalph({
      runAgent: answers(async ({ mode }: AgentInput) => {
        modes.push(mode);
        return 'PASS';
      }),
      runTests: async () => ({ pass: false, tail: 'Tests run: 1, Failures: 1' }),
    }),
    (err: unknown) => err instanceof WorkflowFailedError && /Stuck: 3 runs in a row rejected, after 3 runs\. The judge's last verdict: RETRYABLE The tests fail/.test(err.cause?.message ?? ''),
  );
  assert.deepEqual(modes, Array(3).fill('write'));
});

test('a loop that keeps passing but never finishes stops after 30 runs, a backstop, without an error', async () => {
  let runs = 0;
  const result = await runRalph({
    runAgent: answers(async ({ mode }: AgentInput) => (mode === 'write' && runs++, 'PASS')),
  });
  assert.equal(result, false);
  assert.equal(runs, 30);
});

test('--runs 1 stops after one good step, without an error', async () => {
  const result = await runRalph({ runAgent: answers(async () => 'PASS') }, 1);
  assert.equal(result, false);
});

test('a question waits for your answer, which goes to the next run. An answer sent before the question doesn’t count.', async () => {
  const feedback: (string | null)[] = [];
  let judged = 0;
  let done = false;
  const worker = await createWorker({
    setFeedback: async (_dir: string, text: string | null) => void feedback.push(text),
    runAgent: answers(async ({ mode }: AgentInput) => {
      if (mode === 'write') return 'did a step';
      judged++;
      if (judged === 1) return 'AMBIGUOUS: keep the old table?';
      done = true;
      return 'PASS';
    }),
    taskDone: async () => done,
  });
  const result: RalphResult = await worker.runUntil(async () => {
    const handle = await env.client.workflow.start('ralph', {
      taskQueue: 'test',
      workflowId: `ralph-test-${Math.random()}`,
      args: [{ repoDir: '/repo', agent: 'claude', task: 'TASK-1' }],
    });
    await handle.signal(answerSignal, 'an answer to nothing');
    while ((await handle.query(ralphStatus)).question === undefined) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await handle.signal(answerSignal, 'yes, until TASK-4');
    return handle.result();
  });

  assert.equal(result.done, true);
  assert.deepEqual(feedback, [null, 'The judge asked: keep the old table?\nA human answered: yes, until TASK-4', null]);
});

test('the verdict is the last line that starts with one', () => {
  assert.deepEqual(parseVerdict('Looks fine.\nPASS'), { kind: 'PASS', reason: '' });
  assert.deepEqual(parseVerdict('RETRYABLE: add a test'), { kind: 'RETRYABLE', reason: 'add a test' });
  assert.deepEqual(parseVerdict('no idea'), { kind: 'RETRYABLE', reason: 'the judge gave no verdict' });
});

test('the review agent’s verdict per branch is its last line about that branch', () => {
  const review = 'agent/task-5: APPROVE, I thought at first\n...\nagent/task-5: REJECT, no test for the filter\nagent/task-15: APPROVE';
  assert.deepEqual(findVerdict(review, ['APPROVE', 'REJECT'], 'agent/task-5'), { kind: 'REJECT', reason: 'no test for the filter' });
  assert.equal(findVerdict(review, ['APPROVE', 'REJECT'], 'agent/task-15')?.kind, 'APPROVE');
  assert.equal(findVerdict(review, ['APPROVE', 'REJECT'], 'agent/task-1'), undefined); // task-15 isn't task-1
});

test('the loop works in a worktree of its own, with the implement skill, checked with the judge skill', async () => {
  const runs: AgentInput[] = [];
  const checked: string[] = [];
  const added: unknown[][] = [];
  await runRalph({
    addWorktree: async (...args: unknown[]) => (added.push(args), '/repo/.harness/worktrees/task-1'),
    requireCommitted: async (repo: string, file: string) => void checked.push(`${repo} ${file}`),
    runAgent: answers(async (input: AgentInput) => (runs.push(input), input.mode === 'write' ? 'did a step' : 'PASS')),
    taskDone: async () => runs.length > 0,
  });
  // On its own, it starts from your branch, or goes on with agent/task-1: not fresh
  assert.deepEqual(added, [['/repo', 'task-1', 'agent/task-1', 'abc123', false]]);
  assert.ok(runs.length > 0);
  assert.ok(runs.every((run) => run.repoDir === '/repo' && run.workDir === '/repo/.harness/worktrees/task-1'));
  assert.match(runs[0].prompt, /^Use the implement skill in `\.agents\/skills\/implement\/SKILL\.md`[\s\S]*Your task: TASK-1$/);
  assert.match(runs[1].prompt, /^Use the judge skill in `\.agents\/skills\/judge\/SKILL\.md` to judge this implement run, with the checks in `\.agents\/skills\/judge\/checks\/implement\.md`/);
  // The worktree only has what's committed, so the skills have to be
  assert.deepEqual(checked, ['/repo .agents/skills/implement/SKILL.md', '/repo .agents/skills/judge/SKILL.md', '/repo .agents/skills/judge/checks/implement.md', '/repo .agents/skills/change-quality/SKILL.md']);
});

test('a done task that still has its progress.md is rejected without asking the judge', async () => {
  const feedback: (string | null)[] = [];
  let judged = 0;
  let writes = 0;
  const result = await runRalph({
    setFeedback: async (_dir: string, text: string | null) => void feedback.push(text),
    runAgent: answers(async ({ mode }: AgentInput) => {
      if (mode === 'write') return `step ${++writes}`;
      judged++;
      return 'PASS';
    }),
    taskDone: async () => writes > 0, // the first run finishes it
    progressLeft: async () => writes < 2, // the second run deletes it
  }, 5);
  assert.equal(result, true);
  assert.equal(writes, 2);
  assert.equal(judged, 1);
  assert.match(feedback[1] ?? '', /progress\.md is still there/);
});

test('a task that is already done needs no run', async () => {
  let runs = 0;
  const result = await runRalph({ runAgent: answers(async () => (runs++, 'PASS')), taskDone: async () => true });
  assert.equal(result, true);
  assert.equal(runs, 0);
});

test("a step without a commit is rejected without asking the judge or running the tests", async () => {
  const feedback: (string | null)[] = [];
  const modes: string[] = [];
  let tests = 0;
  await assert.rejects(
    runRalph(
      {
        setFeedback: async (_dir: string, text: string | null) => void feedback.push(text),
        changesSince: async () => ({ files: [], uncommitted: ['src/Flights.java'], commits: '' }),
        runAgent: answers(async ({ mode }: AgentInput) => (modes.push(mode), 'PASS')),
        runTests: async () => (tests++, { pass: true, tail: '' }),
      },
      2,
    ),
  );
  assert.deepEqual(modes, ['write', 'write']);
  assert.equal(tests, 0);
  assert.match(feedback[1] ?? '', /you didn't commit anything/);
});

test('a step that changes what judges it is thrown away', async () => {
  const feedback: (string | null)[] = [];
  const resets: string[] = [];
  await assert.rejects(
    runRalph(
      {
        setFeedback: async (_dir: string, text: string | null) => void feedback.push(text),
        changesSince: async () => ({ files: ['src/Flights.java', '.agents/skills/judge/SKILL.md'], uncommitted: [], commits: '' }),
        resetTo: async (dir: string, before: string) => void resets.push(`${dir}@${before}`),
        runAgent: answers(async () => 'PASS'),
      },
      2,
    ),
  );
  assert.deepEqual(resets, ['/repo/.harness/worktrees/task-1@abc123', '/repo/.harness/worktrees/task-1@abc123']);
  assert.match(feedback[1] ?? '', /you changed \.agents\/skills\/judge\/SKILL\.md, which you must not change/);
});

test('unattended, the judge’s question goes back to the agent, and nobody is asked', async () => {
  const feedback: (string | null)[] = [];
  let judged = 0;
  let done = false;
  const worker = await createWorker({
    setFeedback: async (_dir: string, text: string | null) => void feedback.push(text),
    runAgent: answers(async ({ mode }: AgentInput) => {
      if (mode === 'write') return 'did a step';
      if (++judged === 1) return 'AMBIGUOUS: keep the old table?';
      done = true;
      return 'PASS';
    }),
    taskDone: async () => done,
  });
  const result: RalphResult = await worker.runUntil(
    env.client.workflow.execute('ralph', {
      taskQueue: 'test',
      workflowId: `ralph-test-${Math.random()}`,
      args: [{ repoDir: '/repo', agent: 'claude', task: 'TASK-1', unattended: true }],
    }),
  );
  assert.equal(result.done, true);
  assert.deepEqual(feedback, [
    null,
    'The judge asked: keep the old table?\nNobody answers: make a sensible assumption, write it down where the skill keeps assumptions, and go on.',
    null,
  ]);
});
