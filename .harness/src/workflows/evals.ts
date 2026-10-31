import { CancellationScope, executeChild, isCancellation, setHandler } from '@temporalio/workflow';
import type { Agent, Usage } from '../config';
import { MODELS } from '../config';
import type { PipelineStatus } from '../types/pipeline';
import type { EvalsInput, EvalsReport, EvalsRun, EvalsStatus, EvalsTask, Setup } from '../types/evals';
import { acceptRun, describeSetup, gradeInput, prepareRun, removeCopy, requireCommitted, runAgent, writeReport, writeRun } from './support/activities';
import { failureMessage } from './support/failure';
import { propose } from './improve';
import { pipeline } from './pipeline';
import { gradePrompt, skillFile } from './prompts';
import { evalsStatus } from './signals';
import { branchVerdicts, findVerdict } from './support/text';
import { add, count, usageOf, usageOnly } from './support/usage';

// The evals grades the setup as it is: every task runs `runs` times through the unattended pipeline, each
// run in a copy of its own, and is graded: the task's hidden acceptance tests, then a grader with the
// task's hidden criteria. A run that fails isn't accepted, and what it cost still counts. Writes every run's result and the report to .harness/evals/results/.
export async function evals({ repoDir, agent, evalsId, tasks, runs = 3, parallel = 3, acceptanceFeedback }: EvalsInput): Promise<EvalsReport> {
  // Every run of every task, in order: the first task's runs 1, 2, 3, then the next task's
  const entries: EvalsStatus['runs'] = tasks.flatMap((task) => Array.from({ length: runs }, (_, i) => ({ task: task.id, run: i + 1, state: 'waiting' as const })));
  const status: EvalsStatus = { evalsId, runs: entries };
  setHandler(evalsStatus, () => status);
  const startedAt = new Date().toISOString(); // the workflow's clock: the same on every replay
  // The runs' copies only have what's committed: the grader's review skill, and the checklist it uses
  await requireCommitted(repoDir, skillFile('review'));
  await requireCommitted(repoDir, skillFile('change-quality'));
  const setup = await describeSetup(repoDir);

  const results: EvalsRun[] = [];
  const jobs = status.runs.map((entry) => async () => {
    entry.state = 'running';
    const task = tasks.find((t) => t.id === entry.task)!;
    const grading = () => void (entry.state = 'grading'); // `flows watch` shows it
    const result = await evalsRun(repoDir, agent, evalsId, setup, task, entry.run, grading, acceptanceFeedback);
    await writeRun(repoDir, evalsId, result);
    add(status, result);
    Object.assign(entry, { state: 'done', accepted: result.accepted, costUsd: result.costUsd });
    results.push(result);
  });
  await pool(jobs, parallel);

  const report = summarize(evalsId, startedAt, setup, tasks.map((t) => t.id), results);
  if (acceptanceFeedback) report.acceptanceFeedback = true;
  await writeReport(repoDir, report);

  // Runs that weren't right the first time: the improve agent proposes what to change in the setup
  if (results.every((run) => run.accepted && !run.rejections)) return report;
  status.proposing = true;
  report.proposals = await propose(repoDir, agent, 'evals', evalsId);
  await writeReport(repoDir, report);
  return report;
}

// One run of a task, from the copy to the verdict. A run that fails is a run not accepted. Only a stopped
// evals (`flows evals --stop`) stops it, and then its copy still goes.
async function evalsRun(repoDir: string, agent: Agent, evalsId: string, setup: Setup, task: EvalsTask, run: number, grading: () => void, acceptanceFeedback?: boolean): Promise<EvalsRun> {
  const started = Date.now();
  const usage: Usage = {};
  let outcome: Outcome;
  let copy: string | undefined;
  try {
    const prepared = await prepareRun(repoDir, setup.commit, evalsId, task, run);
    copy = prepared.dir;
    let result: PipelineStatus;
    const acceptance = acceptanceFeedback ? { repoDir, task: task.id } : undefined;
    try {
      result = await executeChild(pipeline, {
        workflowId: `evals-${evalsId}-${task.id}-${run}`,
        args: [{ repoDir: copy, agent, request: task.request, unattended: true, acceptance }],
      });
    } catch (err) {
      add(usage, usageOf(err));
      throw err;
    }
    add(usage, result);
    grading();
    outcome = await grade({ repoDir, dir: copy, base: prepared.base, agent, task, result, usage });
  } catch (err) {
    if (isCancellation(err)) {
      if (copy) await CancellationScope.nonCancellable(() => removeCopy(copy!));
      throw err;
    }
    outcome = { accepted: false, reason: `it failed: ${failureMessage(err)}`, step: 'failed', merged: [] };
  }
  if (copy) await removeCopy(copy);
  const durationS = Math.round((Date.now() - started) / 1000);
  return { task: task.id, run, ...outcome, ...usageOnly(usage), durationS, skillsCommit: setup.skillsCommit, harnessCommit: setup.harnessCommit };
}

type Outcome = Pick<EvalsRun, 'accepted' | 'reason' | 'step' | 'merged' | 'grading' | 'review'>;

interface Graded {
  repoDir: string;
  dir: string; // the run's copy
  base: string; // the commit the copy started from
  agent: Agent;
  task: EvalsTask;
  result: PipelineStatus;
  usage: Usage; // what the run cost so far: the grader counts too
}

// Accepted: the pipeline got to the end and merged something, all the tests pass with the hidden ones,
// and the grader, with the task's hidden criteria, would ship it
async function grade({ repoDir, dir, base, agent, task, result, usage }: Graded): Promise<Outcome> {
  const { step, merged } = result;
  const review = result.review || undefined; // kept whole in the result: why a branch wasn't approved is in it
  if (!merged.length) {
    const why = [...result.unfinished, ...result.notMerged].join('; ') || reviewed(result.review);
    return { accepted: false, reason: `nothing was merged: ${why}`, step, merged, review };
  }
  const tests = await acceptRun(repoDir, dir, task.id);
  if (!tests.pass) {
    return { accepted: false, reason: `the tests fail with the hidden acceptance tests:\n${tests.tail}`, step, merged, review };
  }

  const { criteria, change } = await gradeInput(repoDir, dir, task.id, base);
  const prompt = gradePrompt(task.request, criteria, change);
  const run = await runAgent({ repoDir: dir, agent, mode: 'read', model: MODELS.grader, step: 'grade', prompt });
  const grading = count(usage, 'grader', run);
  const verdict = findVerdict(grading, ['APPROVE', 'REJECT'] as const);
  if (verdict?.kind === 'APPROVE') {
    return { accepted: true, reason: 'the tests pass with the hidden ones, and the grader approves it', step, merged, grading, review };
  }
  const why = verdict ? verdict.reason : 'it gave no verdict';
  return { accepted: false, reason: `the grader rejects it: ${why}`, step, merged, grading, review };
}

// Why the review approved no branch, from its verdict lines
function reviewed(review: string): string {
  const verdicts = branchVerdicts(review);
  if (verdicts.length) return `the review approved no branch: ${verdicts.join('; ')}`;
  return review ? "the review gave no verdict line per branch, like 'agent/task-1: APPROVE'" : 'the review approved no branch';
}

// Runs the jobs, at most `size` at the same time, in order
async function pool(jobs: (() => Promise<void>)[], size: number): Promise<void> {
  const queue = [...jobs];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) await job();
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(size, jobs.length)) }, worker));
}

// The evals' numbers: Quality, Reliability, and Cost per accepted change
export function summarize(evalsId: string, startedAt: string, setup: Setup, tasks: string[], results: EvalsRun[]): EvalsReport {
  const runs = [...results].sort((a, b) => a.task.localeCompare(b.task) || a.run - b.run);
  const total: Usage = { costUsd: 0, models: {} };
  runs.forEach((run) => add(total, run)); // a run without agent runs cost nothing, one that didn't report it makes it unknown
  const accepted = runs.filter((run) => run.accepted).length;
  const reliable = tasks.filter((task) => {
    const ofTask = runs.filter((run) => run.task === task);
    return ofTask.length > 0 && ofTask.every((run) => run.accepted);
  }).length;
  const costUsd = total.costUsd ?? null;
  return {
    evalsId,
    startedAt,
    ...setup,
    tasks,
    runs,
    models: total.models ?? {},
    quality: { accepted, of: runs.length },
    reliability: { tasks: reliable, of: tasks.length },
    firstTimeRight: { runs: runs.filter((run) => run.accepted && !run.rejections).length, of: runs.length },
    costUsd,
    costByRole: total.costByRole,
    costPerAccepted: accepted === 0 ? undefined : costUsd === null ? null : costUsd / accepted,
  };
}
