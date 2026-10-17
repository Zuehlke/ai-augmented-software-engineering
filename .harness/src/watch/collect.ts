// Reads what `flows watch` shows: the workflows from Temporal, the tickets from backlog/, the worker's log
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ApplicationFailure, Client, QueryDefinition, WorkflowFailedError } from '@temporalio/client';
import { temporal } from '@temporalio/proto';
import { readBacklog } from '../backlog';
import type { Usage } from '../shared';
import { branchOf, TASK_QUEUE } from '../shared';
import type { PipelineStatus, RalphResult } from '../types/pipeline';
import type { EvalsProgress, Loop, Other, Pipeline, RunningEvals, Snapshot, State } from './model';
import { readHistory, readSkillHistory } from '../results';
import { evalsStatus, pipelineStatus, ralphStatus, skillLoadedEvalsStatus, statusQuery } from '../workflows/signals';

const STATE = path.join(os.homedir(), '.flows');
export const LOG = process.env.FLOWS_LOG ?? path.join(STATE, 'worker.log');

// Whether the pid file names a running process with `what` in its command line. The pid files
// survive a container restart, where the same pid can belong to another process.
function alive(pidFile: string, what: string): boolean {
  try {
    const pid = Number(readFileSync(pidFile, 'utf8'));
    return readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ').includes(what);
  } catch {
    return false;
  }
}
// In the dev container the worker runs under flows-services.sh, which knows right away when it stops. It starts
// the worker with `flows worker --foreground`, which is in the process's command line whatever the file layout.
// Elsewhere, Temporal knows whether a worker polls, but only a minute or so later.
async function workerRunning(client: Client): Promise<boolean> {
  if (alive(path.join(STATE, 'supervisor.pid'), 'flows-services.sh supervise')) return alive(path.join(STATE, 'worker.pid'), 'worker --foreground');
  return workerPolling(client);
}

interface Execution {
  workflowId: string;
  runId: string;
  status: string; // RUNNING, COMPLETED, FAILED, TERMINATED, ...
  startTime: Date;
}

// A query needs a worker. Without one it would hang, so it gives up after a moment.
function withTimeout<T>(promise: Promise<T>, ms = 2_000): Promise<T | undefined> {
  return Promise.race([promise.catch(() => undefined), new Promise<undefined>((resolve) => setTimeout(resolve, ms))]);
}

// The results of finished workflows don't change, so each is fetched once
// A failed workflow's `usage` is what its runs cost before it failed, see keepingUsage in workflows/usage.ts
const results = new Map<string, { value?: unknown; failure?: string; usage?: Usage }>();

async function result(client: Client, e: Execution): Promise<{ value?: unknown; failure?: string; usage?: Usage }> {
  const key = `${e.workflowId}/${e.runId}`;
  if (!results.has(key)) {
    try {
      results.set(key, { value: await client.workflow.getHandle(e.workflowId, e.runId).result() });
    } catch (err) {
      const message = err instanceof WorkflowFailedError ? (err.cause?.message ?? err.message) : String(err);
      const usage = err instanceof WorkflowFailedError && err.cause instanceof ApplicationFailure ? (err.cause.details?.[0] as Usage | undefined) : undefined;
      results.set(key, { failure: message, usage });
    }
  }
  return results.get(key)!;
}

function stateOf(status: string, value?: unknown): State {
  if (status === 'RUNNING') return 'running';
  // A Ralph loop says whether its ticket is done
  if (status === 'COMPLETED') return (value as RalphResult | undefined)?.done === false ? 'stopped' : 'done';
  if (status === 'TERMINATED' || status === 'CANCELED' || status === 'CANCELLED') return 'stopped';
  return 'failed';
}

async function workerPolling(client: Client): Promise<boolean> {
  const response = await withTimeout(
    client.workflowService.describeTaskQueue({
      namespace: client.options.namespace,
      taskQueue: { name: TASK_QUEUE },
      taskQueueType: temporal.api.enums.v1.TaskQueueType.TASK_QUEUE_TYPE_WORKFLOW,
    }),
  );
  // A worker long-polls for a minute at a time, so a poll within the last 90 seconds means it's there
  const recent = Date.now() - 90_000;
  return (response?.pollers ?? []).some((poller) => Number(poller.lastAccessTime?.seconds ?? 0) * 1000 > recent);
}

// The newest run of each workflow
async function executions(client: Client): Promise<Map<string, Execution>> {
  const latest = new Map<string, Execution>();
  let seen = 0;
  for await (const w of client.workflow.list()) {
    const e = { workflowId: w.workflowId, runId: w.runId, status: w.status.name, startTime: w.startTime };
    const known = latest.get(e.workflowId);
    if (!known || known.startTime < e.startTime) latest.set(e.workflowId, e);
    if (++seen >= 500) break;
  }
  return latest;
}

// Whether the branch is merged into what the repo has checked out, where the pipeline merges to.
// Undefined if there is no such branch, for example after `flows cleanup`.
function merged(repoDir: string, branch: string): boolean | undefined {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', branch, 'HEAD'], { cwd: repoDir, stdio: 'ignore' });
    return true;
  } catch (e) {
    return (e as { status?: number }).status === 1 ? false : undefined;
  }
}

// What keeps a running workflow from going on. Temporal knows this without a worker:
// - its workflow code fails on the worker, and Temporal retries it
// - an activity failed and Temporal retries it, for example an agent that isn't logged in
async function trouble(client: Client, e: Execution): Promise<string | undefined> {
  const description = await withTimeout(client.workflow.getHandle(e.workflowId, e.runId).describe());
  const task = description?.raw.pendingWorkflowTask;
  if (task && (task.attempt ?? 1) > 1) return `its workflow code fails on the worker (attempt ${task.attempt}), see flows logs`;
  for (const activity of description?.raw.pendingActivities ?? []) {
    const message = activity.lastFailure?.message;
    if (message && (activity.attempt ?? 1) > 1) return `${message} (${activity.activityType?.name ?? 'activity'}, attempt ${activity.attempt})`;
  }
  return undefined;
}

// A running workflow: what its `status` query says, and what keeps it from going on. The query fails with a
// nondeterminism error when the workflow's code changed while it ran: its history no longer replays.
async function runningWorkflow<T>(client: Client, e: Execution, query: QueryDefinition<T>): Promise<{ status?: T; trouble?: string }> {
  let queryError = '';
  const asked = client.workflow.getHandle(e.workflowId, e.runId).query(query).catch((err) => {
    queryError = err instanceof Error ? err.message : String(err);
    return undefined;
  });
  const [status, problem] = await Promise.all([withTimeout(asked), trouble(client, e)]);
  if (/nondetermin/i.test(queryError)) return { status, trouble: 'its code changed while it ran, so it can\'t go on. flows cleanup ends it' };
  return { status, trouble: problem };
}

async function pipelineOf(client: Client, e: Execution): Promise<Pipeline> {
  if (e.status === 'RUNNING') {
    const { status, trouble } = await runningWorkflow(client, e, pipelineStatus);
    return { workflowId: e.workflowId, state: 'running', status, trouble };
  }
  const { value, failure } = await result(client, e);
  return { workflowId: e.workflowId, state: stateOf(e.status, value), status: value as PipelineStatus | undefined, failure };
}

async function loopOf(client: Client, e: Execution, prefix: string): Promise<Loop> {
  const loop: Loop = { workflowId: e.workflowId, ticket: e.workflowId.slice(prefix.length), state: 'running' };
  if (e.status === 'RUNNING') {
    const { status, trouble } = await runningWorkflow(client, e, ralphStatus);
    loop.run = status?.run;
    loop.question = status?.question;
    loop.judging = status?.judging;
    loop.costUsd = status?.costUsd;
    loop.trouble = trouble;
    if (loop.question || loop.trouble) loop.state = 'you';
    return loop;
  }
  const { value, failure, usage } = await result(client, e);
  return { ...loop, state: stateOf(e.status, value), failure, costUsd: ((value as RalphResult | undefined) ?? usage)?.costUsd };
}

// The running evals, and where each of its working runs is: its pipeline, evals-<id>-<task>-<run>, and that
// pipeline's Ralph loops, evals-<id>-<task>-<run>-TICKET-<n>
async function evalsOf(client: Client, e: Execution, latest: Map<string, Execution>): Promise<RunningEvals> {
  const { status } = await runningWorkflow(client, e, evalsStatus);
  const working = (status?.runs ?? []).filter((r) => r.state === 'running' || r.state === 'grading');
  const runs = await Promise.all(
    working.map(async ({ task, run, state }): Promise<EvalsProgress> => {
      const id = `${e.workflowId}-${task}-${run}`;
      const found = latest.get(id);
      const progress: EvalsProgress = { task, run, state, loops: [] };
      if (!found) return progress;
      progress.pipeline = (await pipelineOf(client, found)).status;
      const loops = [...latest.values()].filter((l) => l.workflowId.startsWith(`${id}-`)).sort((a, b) => a.workflowId.localeCompare(b.workflowId));
      progress.loops = await Promise.all(
        loops.map(async (l) => {
          const loop = await loopOf(client, l, `${id}-`);
          return { ticket: loop.ticket, state: loop.state, run: loop.run, judging: loop.judging, costUsd: loop.costUsd };
        }),
      );
      return progress;
    }),
  );
  return { workflowId: e.workflowId, status, runs };
}

// The last lines of the worker's log, without reading all of it, and without the colour codes in Temporal's lines
export function tailLog(lines: number, file = LOG): string[] {
  if (!existsSync(file)) return [];
  const size = statSync(file).size;
  const length = Math.min(size, 512 * 1024);
  const buffer = Buffer.alloc(length);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, buffer, 0, length, size - length);
  } finally {
    closeSync(fd);
  }
  return buffer.toString('utf8').replace(/\x1b\[[0-9;]*m/g, '').split('\n').filter((line) => line.trim()).slice(-lines);
}

export async function collect(client: Client | undefined, repoDir: string): Promise<Snapshot> {
  const snapshot: Snapshot = {
    temporal: false, worker: false, loops: [], others: [], backlog: readBacklog(repoDir), log: tailLog(1000),
    evalReports: readHistory(repoDir), skillReports: readSkillHistory(repoDir),
    withoutEvals: !existsSync(path.join(repoDir, '.harness/evals')),
  };
  if (!client) return snapshot;
  let latest: Map<string, Execution>;
  try {
    latest = await executions(client);
  } catch {
    return snapshot; // Temporal isn't reachable
  }
  snapshot.temporal = true;
  snapshot.worker = await workerRunning(client);

  // A finished pipeline only while it's the newest thing: after it, `flows ralph` loops (Labs 10, 11) take over
  const ralphs = [...latest.values()].filter((e) => e.workflowId.startsWith('ralph-'));
  const newestRalph = Math.max(0, ...ralphs.map((e) => e.startTime.getTime()));
  const found = latest.get('pipeline');
  const pipeline = found && (found.status === 'RUNNING' || found.startTime.getTime() > newestRalph) ? found : undefined;
  if (pipeline) snapshot.pipeline = await pipelineOf(client, pipeline);

  const jobs: Promise<void>[] = [];
  for (const e of latest.values()) {
    if (e.workflowId.startsWith('skill-loaded-evals-')) {
      // The skill-loaded evals (skill-loaded-evals-20261016-174500) shows in the Evals tab only
      if (e.status === 'RUNNING' && /^skill-loaded-evals-\d{8}-\d{6}$/.test(e.workflowId)) {
        jobs.push(runningWorkflow(client, e, skillLoadedEvalsStatus).then(({ status }) => void (snapshot.skillLoadedEvals = { workflowId: e.workflowId, status })));
      }
    } else if (e.workflowId.startsWith('evals-')) {
      // The evals (evals-20261016-174500) shows in the Evals tab, its pipelines and their loops (evals-…-<task>-<run>…) only there
      if (e.status === 'RUNNING' && /^evals-\d{8}-\d{6}$/.test(e.workflowId)) {
        jobs.push(evalsOf(client, e, latest).then((evals) => void (snapshot.evals = evals)));
      }
    } else if (e.workflowId.startsWith('pipeline-')) {
      // Only the loops of the pipeline it shows
      if (pipeline && e.startTime >= pipeline.startTime) jobs.push(loopOf(client, e, 'pipeline-').then((loop) => void snapshot.loops.push(loop)));
    } else if (e.workflowId.startsWith('ralph-')) {
      // Next to a pipeline only the running ones, else all of them
      if (e.status === 'RUNNING' || !pipeline) jobs.push(loopOf(client, e, 'ralph-').then((loop) => void snapshot.loops.push(loop)));
    } else if (e.workflowId !== 'pipeline' && e.status === 'RUNNING') {
      jobs.push(
        runningWorkflow(client, e, statusQuery).then(({ status, trouble }) => {
          const other: Other = { workflowId: e.workflowId, state: status?.question || trouble ? 'you' : 'running', question: status?.question, trouble };
          snapshot.others.push(other);
        }),
      );
    }
  }
  await Promise.all(jobs);
  for (const loop of snapshot.loops) {
    if (loop.state === 'done') loop.merged = merged(repoDir, branchOf(loop.ticket));
  }
  return snapshot;
}
