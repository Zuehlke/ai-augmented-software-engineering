// What you can do on the page of `flows watch`: decide, answer, start a loop, throw its work away. The page POSTs
// an action to /api/action. parseAction checks it, act does it: the same signals and workflows as `flows approve`,
// `flows revise`, `flows merge`, `flows answer`, `flows ralph` and `flows evals`.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { newEvalsId } from '../lib/results';
import type { Agent } from '../config';
import { branchOf, EVAL_RUNS, worktreeName } from '../config';
import type { EvalsTask } from '../types/evals';
import type { Checkpoint } from '../types/pipeline';
import type { SignalDefinition } from '@temporalio/workflow';
import { answerSignal, approveSpecificationSignal, approveTasksSignal, decideMergeSignal, reviseSignal } from '../workflows/signals';
import type { Snapshot } from './view-model';

export type Action =
  | { kind: 'start'; request: string } // the feature request that starts the pipeline, as `flows start`
  | { kind: 'approveSpecification'; workflowId: string }
  | { kind: 'approvePlan'; workflowId: string; tasks: string[] }
  | { kind: 'revise'; workflowId: string; on: Checkpoint; feedback: string }
  | { kind: 'decideMerge'; workflowId: string; yes: boolean }
  | { kind: 'answer'; workflowId: string; text: string }
  | { kind: 'ralph'; task: string; runs?: 1 } // a Ralph loop of its own, as `flows ralph <task> [--runs 1]`
  | { kind: 'discard'; task: string } // throws a loop's work away: its workflow, worktree and branch
  | { kind: 'mergeBranch'; task: string } // a finished loop's branch, rebased onto yours
  | { kind: 'diff'; task: string } // what a loop's branch brings, in the IDE
  | { kind: 'delete'; workflowId: string } // a failed workflow, out of Temporal's list
  | { kind: 'evals'; task?: string } // as `flows evals [task] --yes`
  | { kind: 'skillLoadedEvals' } // as `flows skill-loaded-evals`
  | { kind: 'agent'; agent: Agent }; // the agent what you start next runs with

// The body of a POST, checked: every field there and of the right kind. Throws what's wrong, the page shows it.
export function parseAction(body: string): Action {
  let a: Record<string, unknown>;
  try {
    a = JSON.parse(body);
  } catch {
    throw new BadAction('The action is not JSON.');
  }
  const text = (field: string) => {
    if (typeof a[field] !== 'string' || !(a[field] as string).trim()) throw new BadAction(`The action ${a.kind} needs ${field}.`);
    return (a[field] as string).trim();
  };
  const task = () => {
    const id = text('task');
    if (!/^TASK-\d+$/.test(id)) throw new BadAction(`${id} is not a task, like TASK-5.`);
    return id;
  };
  switch (a.kind) {
    case 'start':
      return { kind: 'start', request: text('request') };
    case 'approveSpecification':
    case 'delete':
      return { kind: a.kind, workflowId: text('workflowId') };
    case 'approvePlan':
      if (!Array.isArray(a.tasks) || !a.tasks.every((t) => typeof t === 'string')) throw new BadAction('The action approvePlan needs tasks.');
      return { kind: 'approvePlan', workflowId: text('workflowId'), tasks: a.tasks as string[] };
    case 'revise':
      if (a.on !== 'specification' && a.on !== 'plan') throw new BadAction('Only the specification or the plan can be sent back.');
      return { kind: 'revise', workflowId: text('workflowId'), on: a.on, feedback: text('feedback') };
    case 'decideMerge':
      if (typeof a.yes !== 'boolean') throw new BadAction('The action decideMerge needs yes: true or false.');
      return { kind: 'decideMerge', workflowId: text('workflowId'), yes: a.yes };
    case 'answer':
      return { kind: 'answer', workflowId: text('workflowId'), text: text('text') };
    case 'ralph':
      return a.runs === 1 ? { kind: 'ralph', task: task(), runs: 1 } : { kind: 'ralph', task: task() };
    case 'discard':
    case 'mergeBranch':
    case 'diff':
      return { kind: a.kind, task: task() };
    case 'evals':
      return a.task === undefined ? { kind: 'evals' } : { kind: 'evals', task: text('task') };
    case 'skillLoadedEvals':
      return { kind: 'skillLoadedEvals' };
    case 'agent':
      if (a.agent !== 'claude' && a.agent !== 'copilot') throw new BadAction('The agent is claude or copilot.');
      return { kind: 'agent', agent: a.agent };
    default:
      throw new BadAction(`There is no action ${String(a.kind)}.`);
  }
}

// An action that isn't right: the server answers 400 with its message
export class BadAction extends Error {}

// What the actions need from Temporal: start a workflow, signal one, delete one. index.ts gives the real client.
export interface Workflows {
  start(workflow: string, workflowId: string, input: object): Promise<void>;
  signal<Args extends unknown[]>(workflowId: string, signal: SignalDefinition<Args>, ...args: Args): Promise<void>;
  remove(workflowId: string): Promise<void>;
}

// What the actions need from git and the files, so the tests can give fakes. index.ts gives the real ones.
export interface Repo {
  discardBranch(task: string): string;
  mergeIntoYours(branch: string): Promise<string>;
  openDiff(branch: string): string;
  hasBranch(task: string): boolean;
  evalTasks(): Promise<EvalsTask[]>; // the tasks in .harness/evals/tasks/
  staleWorker(): string | null; // why an evals run would grade other code than you committed
}

// A task's file, and what you can do with it now
export interface TaskView {
  id: string;
  title: string;
  status: string;
  content: string;
  branch: string; // agent/<task>, where its loop works
  worktree: string; // .harness/worktrees/<task>
  start: boolean; // ready, and no loop works on it: start one
  merge: boolean; // its loop is done, its branch isn't merged
  discard: boolean; // a loop of its own left work: throw it away. Never a pipeline's: the pipeline merges it.
}

export function actions(repoDir: string, snapshot: () => Snapshot, workflows: Workflows, repo: Repo, agent: Agent) {
  // A loop of its own (`flows ralph`), not the pipeline's: the only kind you can throw away
  const ownLoop = (task: string) => snapshot().loops.find((l) => l.task === task && l.workflowId === `ralph-${task}`);
  const start = async (workflow: string, workflowId: string, input: object, done: string) => {
    await workflows.start(workflow, workflowId, { repoDir, agent, ...input });
    return done;
  };

  const task = (id: string): TaskView | undefined => {
    const dir = path.join(repoDir, 'backlog');
    const file = (existsSync(dir) ? readdirSync(dir) : []).find((name) => name.startsWith(`${id}-`) && name.endsWith('.md'));
    const found = snapshot().backlog.find((t) => t.id === id);
    if (!file || !found) return undefined;
    const loop = snapshot().loops.find((l) => l.task === id);
    const inPipeline = snapshot().loops.some((l) => l.task === id && l.workflowId !== `ralph-${id}`);
    return {
      id,
      title: found.title,
      status: found.status,
      content: readFileSync(path.join(dir, file), 'utf8'),
      branch: branchOf(id),
      worktree: `.harness/worktrees/${worktreeName(id)}`,
      start: found.status === 'ready' && loop?.state !== 'running' && loop?.state !== 'you',
      merge: loop?.state === 'done' && loop.merged === false,
      discard: !inPipeline && (!!ownLoop(id) || repo.hasBranch(id)),
    };
  };
  // What you can do with a task, checked again here: the page only offers it, the server decides
  const allowed = (id: string, what: 'start' | 'merge' | 'discard') => {
    const view = task(id);
    if (!view) throw new BadAction(`There is no ${id} in backlog/.`);
    if (!view[what]) throw new BadAction(`${id} can't be ${{ start: 'started', merge: 'merged', discard: 'thrown away' }[what]} now.`);
  };

  const act = async (action: Action): Promise<string> => {
    switch (action.kind) {
      case 'start':
        if (snapshot().pipeline?.state === 'running') return 'A pipeline is already running.';
        return start('pipeline', 'pipeline', { request: action.request }, 'Started the pipeline.');
      case 'approveSpecification':
        await workflows.signal(action.workflowId, approveSpecificationSignal);
        return 'Approved. The design agent goes on.';
      case 'approvePlan':
        await workflows.signal(action.workflowId, approveTasksSignal, action.tasks);
        return `Approved: ${action.tasks.join(' ') || 'none'}`;
      case 'revise':
        await workflows.signal(action.workflowId, reviseSignal, action.on, action.feedback);
        return `Sent the ${action.on} back with your feedback.`;
      case 'decideMerge':
        await workflows.signal(action.workflowId, decideMergeSignal, action.yes);
        return action.yes ? 'Merging.' : 'Not merged.';
      case 'answer':
        await workflows.signal(action.workflowId, answerSignal, action.text);
        return 'Sent. The next run gets your answer.';
      case 'ralph':
        allowed(action.task, 'start');
        return start('ralph', `ralph-${action.task}`, { task: action.task, maxRuns: action.runs }, action.runs === 1 ? `Started one run of ralph-${action.task}.` : `Started ralph-${action.task}.`);
      case 'discard': {
        allowed(action.task, 'discard');
        // Deleting the loop from Temporal also stops it, then its worktree and branch go
        const loop = ownLoop(action.task);
        if (loop) await workflows.remove(loop.workflowId).catch(() => {});
        return repo.discardBranch(action.task);
      }
      case 'mergeBranch':
        allowed(action.task, 'merge');
        return repo.mergeIntoYours(branchOf(action.task));
      case 'diff':
        if (!repo.hasBranch(action.task)) throw new BadAction(`${action.task} has no branch ${branchOf(action.task)}.`);
        return repo.openDiff(branchOf(action.task));
      case 'delete':
        await workflows.remove(action.workflowId);
        return `Deleted ${action.workflowId}.`;
      case 'evals': {
        if (snapshot().evals) return 'An evals run is already running.';
        // The same check as `flows evals`: an evals run on a worker with other code would name the wrong commit
        const stale = repo.staleWorker();
        if (stale) return stale;
        const tasks = (await repo.evalTasks()).filter((t) => !action.task || t.id === action.task);
        if (!tasks.length) return `There is no evals task ${action.task} in .harness/evals/tasks/.`;
        const evalsId = newEvalsId();
        return start('evals', `evals-${evalsId}`, { evalsId, tasks, runs: EVAL_RUNS }, `Started evals-${evalsId}: ${tasks.length * EVAL_RUNS} runs.`);
      }
      case 'skillLoadedEvals': {
        if (snapshot().skillLoadedEvals) return 'A skill-loaded evals is already running.';
        const evalsId = newEvalsId();
        return start('skillLoadedEvals', `skill-loaded-evals-${evalsId}`, { evalsId }, `Started skill-loaded-evals-${evalsId}.`);
      }
      case 'agent':
        agent = action.agent;
        return `New workflows start with ${agent}.`;
    }
  };

  return { act, task, agent: () => agent };
}

