// `flows evals` and `flows skill-loaded-evals`: start or follow one, and print its results at the end
import { execFileSync } from 'node:child_process';
import { Client, WorkflowHandle } from '@temporalio/client';
import { listEvalsTasks } from '../activities/evals';
import { estimate, estimateText, formatReport, formatSkillReport, newEvalsId, readHistory } from '../lib/results';
import { EVAL_RUNS, HARNESS_CODE, TASK_QUEUE } from '../config';
import type { EvalsReport } from '../types/evals';
import type { SkillLoadedEvalReport } from '../types/skill-loaded-evals';
import { staleWorker } from '../lib/worker-version';
import { agent, ask, link, noMoreQuestions, repoDir, startOrFollow, workflowFailure } from './common';

// The flags of `flows evals`, see the usage in index.ts
interface EvalsFlags {
  parallel?: number;
  yes: boolean;
  stop: boolean;
  acceptanceFeedback: boolean;
}

export async function evals(client: Client, task: string | undefined, { parallel, yes, stop, acceptanceFeedback }: EvalsFlags): Promise<number> {
  if (stop) return stopEvals(client);
  if (Number.isNaN(parallel) || (parallel !== undefined && parallel < 1)) {
    console.error('Usage: flows evals [task] [--parallel <n>] [--yes] [--acceptance-feedback], or flows evals --stop');
    return 1;
  }
  const root = repoDir();
  const stale = staleWorker(root);
  if (stale) {
    console.error(stale);
    return 1;
  }
  const tasks = await listEvalsTasks(root, task);
  if (!tasks.length) {
    console.error('There are no evals tasks in .harness/evals/tasks/.');
    return 1;
  }
  const runs = EVAL_RUNS;

  // What it will cost, by the last evals, before it spends it
  const expected = estimate(readHistory(root), tasks.length * runs);
  console.log(`${tasks.length * runs} runs: ${tasks.map((t) => t.id).join(', ')}, ${runs} times each. Cost: ${estimateText(expected, 'evals')}.`);
  if (!yes && !(await ask('Start the evals?'))) return 0;
  noMoreQuestions();
  // The runs work in copies of the last commit: what isn't committed isn't graded
  const uncommitted = execFileSync('git', ['status', '--porcelain', '--', '.agents', ...HARNESS_CODE], { cwd: root, encoding: 'utf8' }).trim();
  if (uncommitted) console.log(`Not committed, so not part of what the evals grades:\n${uncommitted}\n`);

  const evalsId = newEvalsId();
  const input = { repoDir: root, agent, evalsId, tasks, runs, parallel, acceptanceFeedback };
  const handle = await startOrFollow(client, 'evals', `evals-${evalsId}`, input);
  console.log(`The runs work in copies under ~/.flows/evals/${evalsId}/, at most ${parallel ?? 3} at the same time.`);
  console.log('The agent output shows up in the worker. Ctrl+C here only stops waiting, the evals goes on: flows evals --stop stops it.');
  let report: EvalsReport;
  try {
    report = await handle.result();
  } catch (err) {
    console.log(`The evals stopped: ${workflowFailure(err)}. The runs that finished are in .harness/evals/results/${evalsId}/.`);
    return 1;
  }
  console.log('');
  for (const line of formatReport(report)) console.log(line);
  return 0;
}

// Stops the running evals runs. Their runs stop with them, the ones that finished keep their results.
async function stopEvals(client: Client): Promise<number> {
  let stopped = 0;
  const query = `ExecutionStatus = "Running" AND WorkflowType = "evals" AND TaskQueue = "${TASK_QUEUE}"`;
  for await (const { workflowId } of client.workflow.list({ query })) {
    await client.workflow.getHandle(workflowId).cancel();
    console.log(`Stopping ${workflowId}: its runs stop, the ones that finished keep their results.`);
    stopped++;
  }
  if (!stopped) console.log('No evals is running.');
  return 0;
}

// Follows the skill-loaded evals that runs, or starts one: skill-loaded-evals-<id>, its results in .harness/evals/results/<id>/
export async function skillLoadedEvals(client: Client): Promise<number> {
  let handle: WorkflowHandle | undefined;
  const query = `ExecutionStatus = "Running" AND WorkflowType = "skillLoadedEvals" AND TaskQueue = "${TASK_QUEUE}"`;
  for await (const { workflowId } of client.workflow.list({ query })) {
    console.log(`${workflowId} is already running, following it: ${link(workflowId)}`);
    handle = client.workflow.getHandle(workflowId);
    break;
  }
  if (!handle) {
    const evalsId = newEvalsId();
    handle = await startOrFollow(client, 'skillLoadedEvals', `skill-loaded-evals-${evalsId}`, { repoDir: repoDir(), agent, evalsId });
  }
  console.log('All runs start at once, this takes a few minutes. The improve agent output shows up in the worker.');
  const report: SkillLoadedEvalReport = await handle.result();
  for (const line of formatSkillReport(report)) console.log(line);
  return report.results.every((result) => result.pass) ? 0 : 1;
}
