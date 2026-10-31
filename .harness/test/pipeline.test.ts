import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { WorkflowHandle } from '@temporalio/client';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { DefaultLogger, Runtime, Worker } from '@temporalio/worker';
import type * as activities from '../src/activities';
import { answers } from './fakes';
import type { AgentInput } from '../src/types/agent';
import type { PipelineStatus } from '../src/types/pipeline';
import { approveSpecificationSignal, approveTasksSignal, decideMergeSignal, pipelineStatus, reviseSignal } from '../src/workflows/signals';

// The pipeline workflow with fake activities: no agent, no git, no tests, just the order of the steps

let env: TestWorkflowEnvironment;
before(async () => {
  Runtime.install({ logger: new DefaultLogger('WARN') });
  env = await TestWorkflowEnvironment.createLocal();
});
after(async () => {
  await env?.teardown();
});

async function waitForStep(handle: WorkflowHandle, step: string): Promise<PipelineStatus> {
  for (;;) {
    const status = await handle.query(pipelineStatus);
    if (status.step === step) return status;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

// What the fake activities saw
interface Seen {
  steps: string[];
  built: string[]; // the worktrees an implement loop committed in
  mergeTried: string[];
  removed: string[];
  diffedIn: string[];
  dispatchedIn: string;
  inputs: string[]; // what the research, design and plan agents got
  removedTasks: string[][];
}

// Fake activities: every agent passes, every task is done after one step. `fakes` changes that.
function createWorker(seen: Seen, fakes: Partial<typeof activities> = {}): Promise<Worker> {
  return Worker.create({
    connection: env.nativeConnection,
    taskQueue: 'test',
    workflowsPath: require.resolve('../src/workflows'),
    activities: {
      requireCommitted: async () => {},
      headCommit: async () => 'base',
      currentBranch: async () => 'main',
      checkoutProblem: async () => null,
      addWorktree: async (_repo: string, name: string) => `/worktrees/${name}`,
      readyTasks: async (repo: string) => {
        seen.dispatchedIn = repo;
        return ['TASK-5', 'TASK-6', 'TASK-7'];
      },
      blockedTasks: async () => [],
      // The plan agent writes TASK-5 and TASK-6 next to TASK-1, until they're removed to plan again
      listTasks: async () => {
        const plans = seen.steps.filter((step) => step.startsWith('plan in')).length;
        return ['TASK-1', ...(plans > seen.removedTasks.length ? ['TASK-5', 'TASK-6'] : [])];
      },
      removeTasks: async (_dir: string, tasks: string[]) => void seen.removedTasks.push(tasks),
      designProblem: async () => null,
      specificationOf: async () => ({ spec: 'specs/delays/specification.md' }),
      removeWorktree: async (_repo: string, name: string) => void seen.removed.push(name),
      branchDiffs: async (dir: string) => {
        seen.diffedIn.push(dir);
        return 'diffs';
      },
      setFeedback: async () => {},
      changesSince: async () => ({ files: ['src/Flights.java'], uncommitted: [], commits: 'commit' }),
      resetTo: async () => {},
      runTests: async () => ({ pass: true, tail: '' }),
      taskDone: async (dir: string) => seen.built.includes(dir),
      progressLeft: async () => false,
      mergeBranch: async (_repo: string, branch: string) => {
        seen.mergeTried.push(branch);
        return branch === 'agent/task-6' ? 'it conflicts with main' : null; // TASK-6 conflicts with TASK-5
      },
      runAgent: answers(async ({ workDir, mode, prompt }: AgentInput) => {
        if (prompt.startsWith('Use the research skill')) {
          assert.match(prompt, /Feature request: Show delays per airport/);
          seen.steps.push(`research in ${workDir}`);
          seen.inputs.push(prompt);
          return '';
        }
        if (prompt.startsWith('Use the design skill')) {
          seen.steps.push(`design in ${workDir}`);
          seen.inputs.push(prompt);
          return '';
        }
        if (prompt.startsWith('Use the plan skill')) {
          seen.steps.push(`plan in ${workDir}`);
          seen.inputs.push(prompt);
          return '';
        }
        if (prompt.startsWith('Use the judge skill')) {
          seen.steps.push(`judge ${/to judge this (\w+) run/.exec(prompt)?.[1]}`);
          return 'PASS';
        }
        if (prompt.startsWith('Use the review skill')) return 'agent/task-5: APPROVE\nagent/task-6: APPROVE';
        if (mode === 'write') seen.built.push(workDir!);
        return 'PASS';
      }),
      ...fakes,
    } satisfies Partial<typeof activities>,
  });
}

const newSeen = (): Seen => ({ steps: [], built: [], mergeTried: [], removed: [], diffedIn: [], dispatchedIn: '', inputs: [], removedTasks: [] });

// Approves the specification, and waits for the plan's checkpoint
async function toPlanApproval(handle: WorkflowHandle): Promise<PipelineStatus> {
  await waitForStep(handle, 'waiting for your specification approval');
  await handle.signal(approveSpecificationSignal);
  return waitForStep(handle, 'waiting for your plan approval');
}

function start(): Promise<WorkflowHandle> {
  return env.client.workflow.start('pipeline', {
    taskQueue: 'test',
    workflowId: `pipeline-test-${Math.random()}`,
    args: [{ repoDir: '/repo', agent: 'claude', request: 'Show delays per airport' }],
  });
}

test('research, design and plan run first in a worktree, each checked by a judge, only approved tasks are built and merged', async () => {
  const seen = newSeen();
  const worker = await createWorker(seen);
  await worker.runUntil(async () => {
    const handle = await start();

    await waitForStep(handle, 'waiting for your specification approval');
    // The research agent works in a worktree. Its branch comes onto yours before you approve the specification.
    const planName = /^research in \/worktrees\/(pipeline-\w{8})$/.exec(seen.steps[0])?.[1];
    assert.ok(planName, seen.steps[0]);
    assert.deepEqual(seen.steps, [`research in /worktrees/${planName}`, 'judge research']);
    assert.deepEqual(seen.mergeTried, [`agent/${planName}`]);
    await handle.signal(approveSpecificationSignal);

    const planned = await waitForStep(handle, 'waiting for your plan approval');
    assert.deepEqual(seen.steps.slice(2), [`design in /worktrees/${planName}`, 'judge design', `plan in /worktrees/${planName}`, 'judge plan']);
    assert.deepEqual(seen.mergeTried, [`agent/${planName}`, `agent/${planName}`]);
    assert.deepEqual(seen.removed, []); // the plan's worktree stays while you can still send the plan back
    assert.equal(seen.dispatchedIn, '/repo');
    assert.deepEqual(planned.tasks, ['TASK-5', 'TASK-6', 'TASK-7']);
    assert.equal(planned.into, 'main');
    await handle.signal(approveTasksSignal, ['TASK-5', 'TASK-6']); // you say no to TASK-7

    const reviewed = await waitForStep(handle, 'waiting for your merge decision');
    assert.deepEqual(seen.removed, [planName]);
    assert.deepEqual(seen.built.sort(), ['/worktrees/task-5', '/worktrees/task-6']);
    assert.deepEqual(seen.diffedIn, ['/repo']);
    assert.deepEqual(reviewed.approvedBranches, ['agent/task-5', 'agent/task-6']);
    await handle.signal(decideMergeSignal, true);

    const result: PipelineStatus = await handle.result();
    assert.deepEqual(seen.mergeTried.slice(2), ['agent/task-5', 'agent/task-6']);
    assert.deepEqual(result.merged, ['agent/task-5']);
    assert.deepEqual(result.notMerged, ['agent/task-6: it conflicts with main']);
    assert.deepEqual(seen.removed.slice(1), ['task-5']); // the merged branch's worktree goes, the other one stays
    assert.equal(result.testsPass, true);
  });
});

test('a loop that fails doesn’t stop the others, only the finished tasks are reviewed', async () => {
  const seen = newSeen();
  const worker = await createWorker(seen, {
    runAgent: answers(async ({ workDir, mode, prompt }: AgentInput) => {
      if (prompt.includes('to judge this implement run') && prompt.includes('TASK-6')) return 'FAILED: the data isn’t there';
      if (prompt.startsWith('Use the review skill')) return 'agent/task-5: APPROVE';
      if (mode === 'write' && workDir?.includes('task-')) seen.built.push(workDir);
      return 'PASS';
    }),
    branchDiffs: async (_repo: string, branches: string[]) => (seen.diffedIn.push(...branches), 'diffs'),
  });
  await worker.runUntil(async () => {
    const handle = await start();
    await toPlanApproval(handle);
    await handle.signal(approveTasksSignal, ['TASK-5', 'TASK-6']);

    const reviewed = await waitForStep(handle, 'waiting for your merge decision');
    assert.deepEqual(seen.diffedIn, ['agent/task-5']);
    assert.deepEqual(reviewed.unfinished, ['TASK-6: the data isn’t there']);
    assert.deepEqual(reviewed.approvedBranches, ['agent/task-5']);
    await handle.signal(decideMergeSignal, false);
    await handle.result();
  });
});

test('when your checkout isn’t ready for the merge, it says why and waits for your decision again', async () => {
  const seen = newSeen();
  const problems = ['you have uncommitted changes on main: commit or stash them'];
  const worker = await createWorker(seen, { checkoutProblem: async () => problems.shift() ?? null });
  await worker.runUntil(async () => {
    const handle = await start();
    await toPlanApproval(handle);
    await handle.signal(approveTasksSignal, ['TASK-5']);
    await waitForStep(handle, 'waiting for your merge decision');
    await handle.signal(decideMergeSignal, true);

    for (;;) {
      const status = await handle.query(pipelineStatus);
      if (status.mergeProblem) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const waiting = await handle.query(pipelineStatus);
    assert.equal(waiting.step, 'waiting for your merge decision');
    assert.equal(seen.mergeTried.length, 2); // only the plan agent's branch, at both checkpoints, nothing of the implement loops yet
    await handle.signal(decideMergeSignal, true);

    const result: PipelineStatus = await handle.result();
    assert.deepEqual(result.merged, ['agent/task-5']);
  });
});

test('the pipeline adds up what every agent run cost, a failed loop’s too, and the model each role ran with', async () => {
  const seen = newSeen();
  let runs = 0;
  const worker = await createWorker(seen, {
    // Every run costs 1 cent, and runs on the latest version of the family its role asked for
    runAgent: async ({ workDir, mode, model, prompt }: AgentInput) => {
      runs++;
      const run = (output: string) => ({ output, costUsd: 0.01, model: `claude-${model}-5-5` });
      if (prompt.includes('to judge this implement run') && prompt.includes('TASK-6')) return run('FAILED: the data isn’t there');
      if (prompt.startsWith('Use the review skill')) return run('agent/task-5: APPROVE');
      if (mode === 'write' && workDir?.includes('task-')) seen.built.push(workDir);
      return run('PASS');
    },
  });
  await worker.runUntil(async () => {
    const handle = await start();
    await toPlanApproval(handle);
    await handle.signal(approveTasksSignal, ['TASK-5', 'TASK-6']);
    await waitForStep(handle, 'waiting for your merge decision');
    await handle.signal(decideMergeSignal, true);
    const result: PipelineStatus = await handle.result();

    // research, design and plan with a judge each, two loops of a step and a judge each, the review
    assert.equal(runs, 11);
    assert.equal(result.costUsd?.toFixed(2), '0.11');
    assert.deepEqual(result.models, {
      research: 'claude-opus-5-5',
      design: 'claude-opus-5-5',
      plan: 'claude-opus-5-5',
      implement: 'claude-sonnet-5-5',
      judge: 'claude-opus-5-5',
      review: 'claude-opus-5-5',
    });
  });
});

test('when an agent reports no cost, as Copilot, the pipeline’s cost is unknown, not 0', async () => {
  const seen = newSeen();
  const worker = await createWorker(seen);
  await worker.runUntil(async () => {
    const handle = await start();
    await toPlanApproval(handle);
    assert.equal((await handle.query(pipelineStatus)).costUsd, null);
    await handle.signal(approveTasksSignal, []);
    await handle.result();
  });
});

test('unattended, it implements every ready task and merges what the review approved, without waiting for anyone', async () => {
  const seen = newSeen();
  const worker = await createWorker(seen, {
    runAgent: answers(async ({ workDir, mode, prompt }: AgentInput) => {
      if (prompt.startsWith('Use the review skill')) return 'agent/task-5: APPROVE\nagent/task-7: REJECT, no test';
      if (mode === 'write' && workDir?.includes('task-')) seen.built.push(workDir);
      return 'PASS';
    }),
    mergeBranch: async (_repo: string, branch: string) => (seen.mergeTried.push(branch), null),
  });
  await worker.runUntil(async () => {
    const handle = await env.client.workflow.start('pipeline', {
      taskQueue: 'test',
      workflowId: `pipeline-test-${Math.random()}`,
      args: [{ repoDir: '/repo', agent: 'claude', request: 'Show delays per airport', unattended: true }],
    });
    const result: PipelineStatus = await handle.result(); // no signal sent

    assert.deepEqual([...new Set(seen.built)].sort(), ['/worktrees/task-5', '/worktrees/task-6', '/worktrees/task-7']);
    assert.deepEqual(result.merged, ['agent/task-5']);
    assert.deepEqual(seen.mergeTried.slice(1), ['agent/task-5']); // the rejected and the unreviewed ones aren't tried
    assert.equal(result.step, 'done');
  });
});

test('unattended, a checkout that can’t take the merge fails the pipeline instead of waiting', async () => {
  const seen = newSeen();
  const worker = await createWorker(seen, { checkoutProblem: async () => 'you have uncommitted changes on main: commit or stash them' });
  await worker.runUntil(async () => {
    const handle = await env.client.workflow.start('pipeline', {
      taskQueue: 'test',
      workflowId: `pipeline-test-${Math.random()}`,
      args: [{ repoDir: '/repo', agent: 'claude', request: 'Show delays per airport', unattended: true }],
    });
    await assert.rejects(handle.result(), (err: Error & { cause?: Error }) => /It can't merge: you have uncommitted changes/.test(err.cause?.message ?? ''));
  });
});

test('unattended, a task that never got to start because its blocker wasn’t merged is reported as unfinished', async () => {
  const seen = newSeen();
  let blockedAsked: string[] = [];
  const worker = await createWorker(seen, {
    readyTasks: async () => ['TASK-5'],
    blockedTasks: async (_repo: string, tasks: string[]) => ((blockedAsked = tasks), ["TASK-6: still blocked, TASK-5 isn't done"]),
    runAgent: answers(async ({ workDir, mode, prompt }: AgentInput) => {
      if (prompt.startsWith('Use the review skill')) return 'agent/task-5: REJECT, no test';
      if (mode === 'write' && workDir?.includes('task-')) seen.built.push(workDir);
      return 'PASS';
    }),
  });
  await worker.runUntil(async () => {
    const handle = await env.client.workflow.start('pipeline', {
      taskQueue: 'test',
      workflowId: `pipeline-test-${Math.random()}`,
      args: [{ repoDir: '/repo', agent: 'claude', request: 'Show delays per airport', unattended: true }],
    });
    const result: PipelineStatus = await handle.result();
    assert.deepEqual(result.merged, []);
    assert.deepEqual(blockedAsked, ['TASK-5']);
    assert.deepEqual(result.unfinished, ["TASK-6: still blocked, TASK-5 isn't done"]);
    assert.equal(result.step, 'done');
  });
});

test('sent back, the research agent revises the specification, and the design and plan agents the plan, its tasks removed first', async () => {
  const seen = newSeen();
  const worker = await createWorker(seen);
  await worker.runUntil(async () => {
    const handle = await start();
    await waitForStep(handle, 'waiting for your specification approval');
    await handle.signal(reviseSignal, 'specification', 'Count cancelled flights too');
    for (;;) {
      if (seen.steps.filter((step) => step.startsWith('research in')).length === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const again = await waitForStep(handle, 'waiting for your specification approval');
    assert.match(seen.inputs[1], /Revise that specification\.md[\s\S]*Count cancelled flights too/);
    assert.deepEqual(again.revised, { specification: 1 });
    await handle.signal(approveSpecificationSignal);

    await waitForStep(handle, 'waiting for your plan approval');
    await handle.signal(reviseSignal, 'plan', 'One task is enough');
    for (;;) {
      if (seen.steps.filter((step) => step.startsWith('plan in')).length === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const replanned = await waitForStep(handle, 'waiting for your plan approval');
    assert.deepEqual(seen.removedTasks, [['TASK-5', 'TASK-6']]);
    const designs = seen.inputs.filter((input) => input.startsWith('Use the design skill'));
    assert.match(designs[0], /Specification: specs\/delays\/specification\.md$/); // the one research wrote, by name
    const plans = seen.inputs.filter((input) => input.startsWith('Use the plan skill'));
    assert.doesNotMatch(designs[0], /Feedback/);
    assert.match(designs[1], /Feedback from a human on the plan[\s\S]*One task is enough/);
    assert.match(plans[1], /Cut the tasks again:[\s\S]*One task is enough/);
    assert.deepEqual(replanned.revised, { specification: 1, plan: 1 });
    await handle.signal(approveTasksSignal, []);
    await handle.result();
  });
});
