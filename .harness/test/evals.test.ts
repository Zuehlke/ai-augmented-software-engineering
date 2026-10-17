import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { DefaultLogger, Runtime, Worker } from '@temporalio/worker';
import type * as activities from '../src/activities';
import { WorkflowFailedError } from '@temporalio/client';
import { Context } from '@temporalio/activity';
import { estimate, formatReport } from '../src/results';
import type { AgentInput } from '../src/types/agent';
import type { EvalsReport, EvalsRun, EvalsTask } from '../src/types/evals';
import { summarize } from '../src/workflows/evals';

// The evals workflow with fake activities: real unattended pipelines and Ralph loops, but no agent, no git,
// no copies and no Maven. Each run's copy is /copies/<task>-<run>, and its worktrees are in there.

let env: TestWorkflowEnvironment;
before(async () => {
  Runtime.install({ logger: new DefaultLogger('WARN') });
  env = await TestWorkflowEnvironment.createLocal();
});
after(async () => {
  await env?.teardown();
});

const SETUP = { commit: 'c0ffee', skillsCommit: 'skills1', harnessCommit: 'harness1' };
const task = (id: string): EvalsTask => ({ id, request: `Feature request of ${id}`, base: 'base1' });

interface Seen {
  runs: EvalsRun[];
  report?: EvalsReport;
  copies: string[]; // the copies there are right now
  most: number; // the most copies there were at the same time
  requests: string[]; // the feature requests the research agents got
  built: Set<string>; // the worktrees whose ticket an agent worked on: they're done after it
}

// Every agent run costs 1 cent and passes. `fakes` changes that.
function createWorker(seen: Seen, fakes: Partial<typeof activities> = {}): Promise<Worker> {
  const { built } = seen;
  return Worker.create({
    connection: env.nativeConnection,
    taskQueue: 'test',
    workflowsPath: require.resolve('../src/workflows'),
    activities: {
      // the evals
      describeSetup: async () => SETUP,
      prepareRun: async (_repo: string, commit: string, _evalsId: string, t: EvalsTask, run: number) => {
        assert.equal(commit, SETUP.commit); // the setup comes from your checkout's last commit
        const dir = `/copies/${t.id}-${run}`;
        seen.copies.push(dir);
        seen.most = Math.max(seen.most, seen.copies.length);
        return { dir, base: 'evalsbase' };
      },
      acceptRun: async () => ({ pass: true, tail: '' }),
      gradeInput: async (_repo: string, dir: string, t: string, base: string) => ({ criteria: `criteria of ${t}`, change: `diff of ${dir} since ${base}` }),
      removeCopy: async (dir: string) => void seen.copies.splice(seen.copies.indexOf(dir), 1),
      writeRun: async (_repo: string, _evalsId: string, run: EvalsRun) => void seen.runs.push(run),
      writeReport: async (_repo: string, report: EvalsReport) => void (seen.report = report),
      // the pipeline and its loops, in the run's copy
      requireCommitted: async () => {},
      headCommit: async () => 'base',
      currentBranch: async () => 'evals',
      checkoutProblem: async () => null,
      addWorktree: async (repo: string, name: string) => `${repo}/worktrees/${name}`,
      readyTickets: async () => ['TICKET-1'],
      blockedTickets: async () => [],
      removeWorktree: async () => {},
      branchDiffs: async () => 'diffs',
      setFeedback: async () => {},
      changesSince: async () => ({ files: ['src/Flights.java'], uncommitted: [], commits: 'commit' }),
      resetTo: async () => {},
      runTests: async () => ({ pass: true, tail: '' }),
      ticketDone: async (dir: string) => built.has(dir),
      progressLeft: async () => false,
      failingHiddenTests: async () => [],
      mergeBranch: async () => null,
      runAgent: async ({ workDir, mode, model, prompt }: AgentInput) => {
        if (prompt.startsWith('Use the research skill')) seen.requests.push(/Feature request: (.*)/.exec(prompt)![1]);
        if (mode === 'write' && workDir?.includes('/worktrees/ticket-')) built.add(workDir);
        const output = prompt.includes('on the branches below') ? 'agent/ticket-1: APPROVE' : prompt.includes('on the change below') ? 'Clean change.\nAPPROVE' : 'PASS';
        return { output, costUsd: 0.01, model: `claude-${model}-5-5` };
      },
      ...fakes,
    } satisfies Partial<typeof activities>,
  });
}

const newSeen = (): Seen => ({ runs: [], copies: [], most: 0, requests: [], built: new Set() });

function runEvals(worker: Worker, tasks: EvalsTask[], parallel?: number): Promise<EvalsReport> {
  return worker.runUntil(
    env.client.workflow.execute('evals', {
      taskQueue: 'test',
      workflowId: `evals-test-${Math.random()}`,
      args: [{ repoDir: '/repo', agent: 'claude', evalsId: 'b1', tasks, parallel }],
    }),
  );
}

test('every task runs 3 times through the unattended pipeline, each run is graded, stored, and counted', async () => {
  const seen = newSeen();
  const worker = await createWorker(seen, {
    // Run 2's loop fails, run 3 merges but fails the hidden tests
    runAgent: async ({ workDir, mode, model, prompt }: AgentInput) => {
      const run = (output: string) => ({ output, costUsd: 0.01, model: `claude-${model}-5-5` });
      if (prompt.startsWith('Use the research skill')) seen.requests.push(/Feature request: (.*)/.exec(prompt)![1]);
      if (mode === 'write' && workDir?.includes('/worktrees/ticket-')) seen.built.add(workDir);
      if (prompt.includes('to judge this implement run') && workDir?.startsWith('/copies/t1-2/')) return run('FAILED: the data isn’t there');
      if (prompt.includes('on the branches below')) return run('agent/ticket-1: APPROVE');
      if (prompt.includes('on the change below')) return run('APPROVE');
      return run('PASS');
    },
    acceptRun: async (_repo: string, dir: string) => (dir === '/copies/t1-3' ? { pass: false, tail: 'MinDelayAcceptanceTest FAILED' } : { pass: true, tail: '' }),
  });
  const report = await runEvals(worker, [task('t1')]);

  assert.deepEqual(seen.requests, ['Feature request of t1', 'Feature request of t1', 'Feature request of t1']);
  assert.equal(seen.runs.length, 3);
  assert.deepEqual(report.runs.map((r) => [r.run, r.accepted]), [[1, true], [2, false], [3, false]]);
  assert.deepEqual(report.quality, { accepted: 1, of: 3 });
  assert.deepEqual(report.reliability, { tasks: 0, of: 1 });
  assert.equal(report.runs[2].reason, 'the tests fail with the hidden acceptance tests:\nMinDelayAcceptanceTest FAILED');
  assert.equal(report.runs[0].skillsCommit, 'skills1');
  assert.equal(report.runs[0].models?.implement, 'claude-sonnet-5-5');
  assert.equal(report.commit, 'c0ffee');
  assert.deepEqual(seen.report, report);
  assert.deepEqual(seen.copies, []); // every copy is gone
});

test('a run that fails counts as not accepted, and what its agents cost still counts', async () => {
  const seen = newSeen();
  const worker = await createWorker(seen, {
    // In run 1 the research judge fails the pipeline itself, after one agent run and its judge
    runAgent: async ({ workDir, mode, model, prompt }: AgentInput) => {
      const run = (output: string) => ({ output, costUsd: 0.01, model: `claude-${model}-5-5` });
      if (mode === 'write' && workDir?.includes('/worktrees/ticket-')) seen.built.add(workDir);
      if (prompt.includes('to judge this research run') && workDir?.startsWith('/copies/t1-1/')) return run('FAILED: the request is unclear');
      if (prompt.includes('on the branches below')) return run('agent/ticket-1: APPROVE');
      if (prompt.includes('on the change below')) return run('APPROVE');
      return run('PASS');
    },
  });
  const report = await runEvals(worker, [task('t1')]);
  const failed = report.runs[0];
  assert.equal(failed.accepted, false);
  assert.equal(failed.step, 'failed');
  assert.match(failed.reason, /the request is unclear/);
  assert.equal(failed.costUsd?.toFixed(2), '0.02');
  assert.ok(report.runs.slice(1).every((r) => r.accepted), JSON.stringify(report.runs.map((r) => r.reason)));
  // research, plan, the loop: a step and a judge each, the review and the grader: 8 runs, in 2 runs of the task
  assert.equal(report.costUsd?.toFixed(2), '0.18');
  assert.equal(report.costPerAccepted?.toFixed(2), '0.09');
});

test('a run in which a judge rejected a step is accepted, but not first time right, and the cost is split by role', async () => {
  const seen = newSeen();
  let rejectedOnce = false;
  const worker = await createWorker(seen, {
    runAgent: async ({ workDir, mode, model, prompt }: AgentInput) => {
      const run = (output: string) => ({ output, costUsd: 0.01, model: `claude-${model}-5-5` });
      if (mode === 'write' && workDir?.includes('/worktrees/ticket-')) seen.built.add(workDir);
      if (prompt.includes('to judge this implement run') && workDir?.startsWith('/copies/t1-1/') && !rejectedOnce) return (rejectedOnce = true), run('RETRYABLE: no test for a blank status');
      if (prompt.includes('on the branches below')) return run('agent/ticket-1: APPROVE');
      if (prompt.includes('on the change below')) return run('APPROVE');
      return run('PASS');
    },
  });
  const report = await runEvals(worker, [task('t1')]);
  assert.ok(report.runs.every((r) => r.accepted));
  assert.deepEqual(report.runs.map((r) => r.rejections ?? 0), [1, 0, 0]);
  assert.deepEqual(report.firstTimeRight, { runs: 2, of: 3 });
  assert.equal(report.runs[1].costByRole?.research, 0.01);
  assert.equal(report.runs[1].costByRole?.judge?.toFixed(2), '0.03'); // research, plan, the loop's step
  assert.equal(report.runs[0].costByRole?.judge?.toFixed(2), '0.04'); // and the rejected step's second run
  assert.equal(report.runs[1].costByRole?.grader, 0.01);
  assert.equal(report.costByRole?.review?.toFixed(2), '0.03');
});

test('a copy that can’t be made fails only its run', async () => {
  const seen = newSeen();
  const worker = await createWorker(seen, {
    prepareRun: async (_repo: string, _commit: string, _evalsId: string, t: EvalsTask, run: number) => {
      if (run === 2) throw new Error('disk full');
      return { dir: `/copies/${t.id}-${run}`, base: 'evalsbase' };
    },
  });
  const report = await runEvals(worker, [task('t1')]);
  assert.deepEqual(report.runs.map((r) => r.accepted), [true, false, true]);
  assert.match(report.runs[1].reason, /^it failed: /);
});

test('at most `parallel` runs work at the same time, and the runs of all tasks don’t collide', async () => {
  const seen = newSeen();
  const worker = await createWorker(seen);
  const report = await runEvals(worker, [task('t1'), task('t2')], 2);
  assert.equal(seen.most, 2);
  assert.equal(report.runs.length, 6);
  assert.ok(report.runs.every((r) => r.accepted)); // 6 pipelines, each with its own Ralph loop for TICKET-1
  assert.deepEqual(report.reliability, { tasks: 2, of: 2 });
});

const run = (task: string, n: number, accepted: boolean, costUsd: number | null | undefined): EvalsRun => ({
  task, run: n, accepted, reason: accepted ? 'the tests pass' : 'nothing was merged: TICKET-1: out of runs', costUsd, durationS: 60, step: 'done', merged: [], skillsCommit: 's', harnessCommit: 'h',
});

test('the numbers: no accepted run has no cost per accepted change, a run without a cost makes it unknown', () => {
  const none = summarize('b', 'now', SETUP, ['t1'], [run('t1', 1, false, 0.5), run('t1', 2, false, 0.5)]);
  assert.equal(none.costPerAccepted, undefined);
  assert.equal(none.costUsd, 1);
  const unknown = summarize('b', 'now', SETUP, ['t1'], [run('t1', 1, true, 0.5), run('t1', 2, true, null)]);
  assert.equal(unknown.costUsd, null);
  assert.equal(unknown.costPerAccepted, null);
  const nothingRan = summarize('b', 'now', SETUP, ['t1'], [run('t1', 1, false, undefined)]);
  assert.equal(nothingRan.costUsd, 0); // no agent ran, so nothing was spent
});

test('flows evals prints every task’s runs, why runs weren’t accepted, and the three numbers', () => {
  const report = summarize('20261016-174500', 'now', SETUP, ['min-delay-filter', 'csv'], [
    run('min-delay-filter', 1, true, 1.2), run('min-delay-filter', 2, true, 1.0), run('min-delay-filter', 3, false, 0.8),
    run('csv', 1, true, 0.6), run('csv', 2, true, 0.6), run('csv', 3, true, 0.6),
  ]);
  assert.deepEqual(formatReport(report), [
    'min-delay-filter  ✓ ✓ ✗',
    'csv               ✓ ✓ ✓',
    '',
    'Not accepted:',
    '  min-delay-filter run 3: nothing was merged: TICKET-1: out of runs',
    '',
    'Quality      5 / 6 runs accepted',
    'Reliability  1 / 2 tasks with every run accepted',
    'First time   5 / 6 runs accepted without a judge or a test rejecting a step',
    'Cost         $0.96 per accepted change, $4.80 in total',
    '',
    'Results: .harness/evals/results/20261016-174500/',
  ]);
});

test('the grader gets the request, the hidden criteria and the run’s change, and decides with APPROVE or REJECT', async () => {
  const seen = newSeen();
  const prompts: string[] = [];
  const worker = await createWorker(seen, {
    runAgent: async ({ repoDir, workDir, mode, model, prompt }: AgentInput) => {
      const run = (output: string) => ({ output, costUsd: 0.01, model: `claude-${model}-5-5` });
      if (mode === 'write' && workDir?.includes('/worktrees/ticket-')) seen.built.add(workDir);
      if (prompt.includes('on the branches below')) return run('agent/ticket-1: APPROVE');
      if (!prompt.includes('on the change below')) return run('PASS');
      prompts.push(prompt);
      assert.equal(mode, 'read');
      assert.equal(model, 'opus');
      if (repoDir === '/copies/t1-2') return run('The filter uses the first event, not the latest.\nREJECT: filters on an old delay event');
      if (repoDir === '/copies/t1-3') return run('I am not sure.');
      return run('APPROVE');
    },
  });
  const report = await runEvals(worker, [task('t1')]);

  assert.match(prompts[0], /FEATURE REQUEST\n\nFeature request of t1\n\nCRITERIA\n\ncriteria of t1\n\nCHANGE\n\ndiff of \/copies\/t1-\d since evalsbase/);
  assert.deepEqual(report.runs.map((r) => r.accepted), [true, false, false]);
  assert.equal(report.runs[1].reason, 'the grader rejects it: filters on an old delay event');
  assert.equal(report.runs[1].grading, 'The filter uses the first event, not the latest.\nREJECT: filters on an old delay event');
  assert.equal(report.runs[2].reason, 'the grader rejects it: it gave no verdict');
  assert.equal(report.runs[0].models?.grader, 'claude-opus-5-5');
  assert.equal(report.runs[0].costUsd?.toFixed(2), '0.08'); // 7 runs of the pipeline, and the grader
});

test('the grader only grades what passes the hidden tests', async () => {
  const seen = newSeen();
  let graded = 0;
  const worker = await createWorker(seen, {
    acceptRun: async () => ({ pass: false, tail: 'FAILED' }),
    gradeInput: async () => (graded++, { criteria: '', change: '' }),
  });
  const report = await runEvals(worker, [task('t1')]);
  assert.equal(graded, 0);
  assert.ok(report.runs.every((r) => !r.accepted && r.grading === undefined));
});

test('a stopped evals stops its runs, keeps the ones that finished, and removes every copy', async () => {
  const seen = newSeen();
  let waiting = false;
  const worker = await createWorker(seen, {
    // Run 2's research agent works until the evals is stopped
    runAgent: async ({ workDir, mode, model, prompt }: AgentInput) => {
      if (workDir?.startsWith('/copies/t1-2/') && prompt.startsWith('Use the research skill')) {
        waiting = true;
        const { cancellationSignal } = Context.current();
        await new Promise((resolve) => {
          cancellationSignal.addEventListener('abort', resolve);
          setTimeout(resolve, 5_000);
        });
      }
      if (mode === 'write' && workDir?.includes('/worktrees/ticket-')) seen.built.add(workDir);
      const output = prompt.includes('on the branches below') ? 'agent/ticket-1: APPROVE' : prompt.includes('on the change below') ? 'APPROVE' : 'PASS';
      return { output, costUsd: 0.01, model: `claude-${model}-5-5` };
    },
  });
  await worker.runUntil(async () => {
    const handle = await env.client.workflow.start('evals', {
      taskQueue: 'test',
      workflowId: `evals-test-${Math.random()}`,
      args: [{ repoDir: '/repo', agent: 'claude', evalsId: 'b1', tasks: [task('t1')], parallel: 1 }],
    });
    while (!waiting) await new Promise((resolve) => setTimeout(resolve, 50));
    await handle.cancel();
    await assert.rejects(handle.result(), (err) => err instanceof WorkflowFailedError && /cancel/i.test(String(err.cause?.name ?? err.cause)));
  });
  assert.deepEqual(seen.runs.map((r) => [r.run, r.accepted]), [[1, true]]); // run 1 finished and keeps its result
  assert.equal(seen.report, undefined); // a stopped evals has no report
  assert.deepEqual(seen.copies, []);
});

test('the estimate is the last evals’s average run, times the runs to come', () => {
  const report = (costUsd: number | null, runs: number) => ({ ...summarize('b', 'now', SETUP, ['t1'], []), costUsd, runs: Array.from({ length: runs }, (_, i) => run('t1', i + 1, true, 1)) });
  assert.equal(estimate([], 15), undefined);
  assert.equal(estimate([report(9, 3), report(6, 3)], 15), 30); // the last one: $2 a run
  assert.equal(estimate([report(null, 3)], 15), null);
});

test('a run nothing of which was merged keeps the review whole, and says what the review said per branch', async () => {
  const seen = newSeen();
  const review = 'Looks incomplete.\n\n**agent/ticket-1: REJECT, no test covers status with airline_code**';
  const worker = await createWorker(seen, {
    runAgent: async ({ workDir, mode, model, prompt }: AgentInput) => {
      const run = (output: string) => ({ output, costUsd: 0.01, model: `claude-${model}-5-5` });
      if (mode === 'write' && workDir?.includes('/worktrees/ticket-')) seen.built.add(workDir);
      if (prompt.includes('on the branches below')) return run(review);
      return run('PASS');
    },
  });
  const report = await runEvals(worker, [task('t1')]);
  assert.equal(report.runs[0].accepted, false);
  assert.equal(report.runs[0].reason, 'nothing was merged: the review approved no branch: agent/ticket-1: REJECT, no test covers status with airline_code');
  assert.equal(report.runs[0].review, review);
});

test('a review without a verdict line per branch is said to be one', async () => {
  const seen = newSeen();
  const worker = await createWorker(seen, {
    runAgent: async ({ workDir, mode, model, prompt }: AgentInput) => {
      const run = (output: string) => ({ output, costUsd: 0.01, model: `claude-${model}-5-5` });
      if (mode === 'write' && workDir?.includes('/worktrees/ticket-')) seen.built.add(workDir);
      return run(prompt.includes('on the branches below') ? 'I approve the change.' : 'PASS');
    },
  });
  const report = await runEvals(worker, [task('t1')]);
  assert.match(report.runs[0].reason, /the review gave no verdict line per branch/);
});

test('with acceptance feedback, a loop learns the names of the failing hidden tests once its ticket is done, and only then', async () => {
  const seen = newSeen();
  const asked: string[] = [];
  const feedback: string[] = [];
  const worker = await createWorker(seen, {
    failingHiddenTests: async (repo: string, _dir: string, t: string) => {
      asked.push(`${repo}:${t}`);
      return asked.length === 1 ? ['StatusAcceptanceTest.badRequest'] : [];
    },
    setFeedback: async (_dir: string, text: string | null) => void (text && feedback.push(text)),
    runAgent: async ({ workDir, mode, model, prompt }: AgentInput) => {
      const run = (output: string) => ({ output, costUsd: 0.01, model: `claude-${model}-5-5` });
      if (mode === 'write' && workDir?.includes('/worktrees/ticket-')) seen.built.add(workDir);
      return run(prompt.includes('on the branches below') ? 'agent/ticket-1: APPROVE' : prompt.includes('on the change below') ? 'APPROVE' : 'PASS');
    },
  });
  const report = await worker.runUntil(
    env.client.workflow.execute('evals', {
      taskQueue: 'test',
      workflowId: `evals-test-${Math.random()}`,
      args: [{ repoDir: '/repo', agent: 'claude', evalsId: 'b1', tasks: [task('t1')], runs: 1, acceptanceFeedback: true }],
    }),
  );
  assert.equal(report.acceptanceFeedback, true);
  assert.ok(asked.every((a) => a === '/repo:t1'));
  assert.ok(feedback.some((f) => /StatusAcceptanceTest\.badRequest/.test(f)), JSON.stringify(feedback));
  assert.ok(feedback.every((f) => !/expected/.test(f))); // names only
});

test('when runs weren’t right the first time, the improve agent proposes changes, from the results and the judges’ reasons', async () => {
  const seen = newSeen();
  let rejectedOnce = false;
  const improve: AgentInput[] = [];
  const worker = await createWorker(seen, {
    // Run 1: a judge rejects a step once. Runs 2 and 3: right the first time.
    runAgent: async (input: AgentInput) => {
      const { workDir, mode, model, prompt } = input;
      const run = (output: string) => ({ output, costUsd: 0.01, model: `claude-${model}-5-5` });
      if (mode === 'write' && workDir?.includes('/worktrees/ticket-')) seen.built.add(workDir);
      if (prompt.includes('to judge this implement run') && workDir?.startsWith('/copies/t1-1/') && !rejectedOnce) return (rejectedOnce = true), run('RETRYABLE: no test for a blank status');
      if (prompt.includes('on the branches below')) return run('agent/ticket-1: APPROVE');
      if (prompt.includes('on the change below')) return run('APPROVE');
      if (prompt.startsWith('Use the improve skill')) return improve.push(input), run('## Test blank values\n');
      return run('PASS');
    },
  });
  const report = await runEvals(worker, [task('t1')]);
  assert.deepEqual(report.runs[0].rejectedBecause, ['implement: no test for a blank status']);

  // One run of the improve agent for the whole evals, read-only, in your checkout
  assert.equal(improve.length, 1);
  assert.deepEqual([improve[0].repoDir, improve[0].workDir, improve[0].mode], ['/repo', undefined, 'read']);
  assert.match(improve[0].prompt, /on the evals that just ran: its results are in `\.harness\/evals\/results\/b1\/`/); // it reads them, and the earlier ones, itself

  assert.equal(report.proposals, '## Test blank values');
  assert.equal(seen.report?.proposals, report.proposals); // the report is written again, with them
});

test('no proposals when every run was right the first time', async () => {
  const seen = newSeen();
  const report = await runEvals(await createWorker(seen), [task('t1')]);
  assert.equal(report.firstTimeRight?.runs, 3);
  assert.equal(report.proposals, undefined);
});

test('without acceptance feedback, no loop runs the hidden tests', async () => {
  const seen = newSeen();
  let asked = 0;
  const worker = await createWorker(seen, { failingHiddenTests: async () => (asked++, []) });
  const report = await runEvals(worker, [task('t1')]);
  assert.equal(asked, 0);
  assert.equal(report.acceptanceFeedback, undefined);
});
