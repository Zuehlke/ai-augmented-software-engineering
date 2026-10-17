// What `flows watch` shows, worked out from a snapshot of Temporal and backlog/. No I/O here.
import type { PipelineStatus, Ticket } from '../types/pipeline';
import type { EvalsReport, EvalsRun, EvalsStatus } from '../types/evals';
import type { SkillLoadedEvalReport, SkillLoadedEvalsStatus } from '../types/skill-loaded-evals';

// running: an agent works on it. you: it waits for a person. failed: it stopped with an error.
// done: finished. stopped: finished without being done (out of runs, or stopped by `flows cleanup`).
export type State = 'running' | 'you' | 'failed' | 'done' | 'stopped';

// One Ralph loop: `pipeline-<ticket>` in the pipeline (Lab 12), `ralph-<ticket>` on its own (Labs 10, 11)
export interface Loop {
  workflowId: string;
  ticket: string;
  state: State;
  run?: number;
  question?: string;
  judging?: boolean;
  failure?: string;
  trouble?: string;
  merged?: boolean; // whether its branch agent/<ticket> is merged, once it's done. Unset if the branch is gone.
  costUsd?: number | null; // what its agent runs cost so far
}

export interface Pipeline {
  workflowId: string;
  state: State;
  status?: PipelineStatus; // from its `status` query while it runs, from its result once it's done
  failure?: string;
  trouble?: string;
}

// Any other workflow, for example `plan` (Lab 9) or `evals` (Lab 13)
export interface Other {
  workflowId: string;
  state: State;
  question?: string;
  trouble?: string;
}

export type { Ticket };

// One run of the running evals while it works: where its pipeline is, and its Ralph loops
export interface EvalsProgress {
  task: string;
  run: number;
  state: EvalsStatus['runs'][number]['state'];
  pipeline?: PipelineStatus; // from its `status` query while it runs, from its result once it's done
  loops: { ticket: string; state: State; run?: number; judging?: boolean; costUsd?: number | null }[];
}

// The evals that runs right now, `flows evals`
export interface RunningEvals {
  workflowId: string;
  status?: EvalsStatus;
  runs: EvalsProgress[]; // the ones that work right now
}

export interface Snapshot {
  temporal: boolean;
  worker: boolean;
  pipeline?: Pipeline;
  loops: Loop[];
  others: Other[];
  backlog: Ticket[];
  log: string[];
  evalReports: EvalsReport[]; // every evals that finished, the oldest first, from .harness/evals/results/
  evals?: RunningEvals;
  skillReports: SkillLoadedEvalReport[]; // every skill-loaded evals that finished, the oldest first, from .harness/evals/results/
  skillLoadedEvals?: RunningSkillLoadedEvals;
  withoutEvals?: boolean; // the branch has no .harness/evals/ yet, as before Lab 13: no Evals tab
}

// The skill-loaded evals that runs right now, `flows skill-loaded-evals`
export interface RunningSkillLoadedEvals {
  workflowId: string;
  status?: SkillLoadedEvalsStatus;
}

// How an evals run's number compares with the evals before: within noise, or a real change. 5 tasks of 3 runs
// are few: less than 3 runs for Quality, 1 task for Reliability, can be chance.
export type Change = 'first' | 'noise' | 'better' | 'worse';

// One column of the Evals tab's trend
export interface TrendColumn {
  report: EvalsReport;
  label: string; // when it started, 10-16 17:45
  commit: string; // the commit it graded, short
  modelsChanged: boolean; // a role ran with another model than in the evals before
  quality: Change;
  reliability: Change;
}

function change(delta: number | undefined, noise: number): Change {
  if (delta === undefined) return 'first';
  if (Math.abs(delta) <= noise) return 'noise';
  return delta > 0 ? 'better' : 'worse';
}

export function trend(evalReports: EvalsReport[]): TrendColumn[] {
  const models = (r: EvalsReport) => JSON.stringify(Object.entries(r.models ?? {}).sort());
  return evalReports.map((report, i) => {
    const before = evalReports[i - 1];
    return {
      report,
      label: labelOf(report.evalsId),
      commit: report.commit.slice(0, 7),
      modelsChanged: !!before && models(before) !== models(report),
      quality: change(before && report.quality.accepted - before.quality.accepted, 2),
      reliability: change(before && report.reliability.tasks - before.reliability.tasks, 1),
    };
  });
}

// When an evals run started, 10-16 17:45, from its id
export function labelOf(evalsId: string): string {
  const [, month, day, hour, minute] = /^\d{4}(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(evalsId) ?? [];
  return month ? `${month}-${day} ${hour}:${minute}` : evalsId;
}

// One column of the trend for a skill-loaded evals: its cases that pass. A change of 1 case can be chance.
export interface SkillTrendColumn {
  report: SkillLoadedEvalReport;
  label: string;
  commit: string;
  passing: Change;
}

export function passingCases(report: SkillLoadedEvalReport): number {
  return report.results.filter((result) => result.pass).length;
}

export function skillTrend(skillReports: SkillLoadedEvalReport[]): SkillTrendColumn[] {
  return skillReports.map((report, i) => {
    const before = skillReports[i - 1];
    return { report, label: labelOf(report.evalsId), commit: report.commit.slice(0, 7), passing: change(before && passingCases(report) - passingCases(before), 1) };
  });
}

// The runs of the latest evals, one row per task, the runs in order
export function evalsGrid(report: EvalsReport | undefined): { task: string; runs: EvalsRun[] }[] {
  if (!report) return [];
  return report.tasks.map((task) => ({ task, runs: report.runs.filter((run) => run.task === task).sort((a, b) => a.run - b.run) }));
}

// What waits for a person, in the order they should look at it
export type Need =
  | { kind: 'approve'; workflowId: string; tickets: string[] }
  | { kind: 'merge'; workflowId: string; branches: string[]; review: string; problem?: string }
  | { kind: 'answer'; workflowId: string; ticket?: string; question: string }
  | { kind: 'failed'; workflowId: string; reason: string }
  // It still runs, but an activity keeps failing and Temporal retries it, for example an agent that isn't logged in
  | { kind: 'stuck'; workflowId: string; reason: string };

// What a pipeline's agent runs cost so far. Its own status counts its loops only once they all finished,
// so while they work, their cost so far is added here.
function soFar(status: PipelineStatus | undefined, loops: (number | null | undefined)[]): number | null | undefined {
  const own = status?.costUsd;
  if (status?.step !== 'implementing') return own;
  if (own === null || loops.includes(null)) return null;
  return [own, ...loops].reduce<number>((sum, cost) => sum + (cost ?? 0), 0);
}

export function pipelineCost(s: Snapshot): number | null | undefined {
  return soFar(s.pipeline?.status, s.loops.filter((loop) => loop.workflowId.startsWith('pipeline-')).map((loop) => loop.costUsd));
}

// What a run of the running evals cost so far
export function progressCost(p: EvalsProgress): number | null | undefined {
  return soFar(p.pipeline, p.loops.map((loop) => loop.costUsd));
}

// What the running evals cost so far: its finished runs, and what the working ones spent
export function evalsCost(evals: RunningEvals): number | null | undefined {
  const costs = [evals.status?.costUsd, ...evals.runs.map(progressCost)];
  if (costs.includes(null)) return null;
  return costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0);
}

// Where a run of the running evals is: its phase, what the phase does right now, whether a judge checks, and whether it waits for you
export function progressOf(p: EvalsProgress): { phase: string; detail: string; judging: boolean; you: boolean } {
  const grading = { phase: 'grading', detail: 'hidden tests, then the grader', judging: false, you: false };
  if (p.state === 'grading') return grading;
  const status = p.pipeline;
  if (!status) return { phase: 'starting', detail: '', judging: false, you: false };
  const judging = !!status.judging || p.loops.some((loop) => loop.judging);
  const you = status.step.startsWith('waiting for your') || p.loops.some((loop) => loop.state === 'you');
  switch (status.step) {
    case 'researching':
      return { phase: 'research', detail: `run ${status.run ?? 1}`, judging, you };
    case 'planning':
      return { phase: 'plan', detail: `run ${status.run ?? 1}`, judging, you };
    case 'implementing': {
      const loops = p.loops.map((loop) => {
        if (loop.state === 'running') return `${loop.ticket} step ${loop.run ?? 1}`;
        return `${loop.ticket} ${loop.state === 'done' ? '✓' : loop.state}`;
      });
      return { phase: 'implement', detail: loops.join(', ') || 'starting the loops', judging, you };
    }
    case 'reviewing':
      return { phase: 'review', detail: '', judging, you };
    case 'merging':
      return { phase: 'merging', detail: '', judging, you };
    case 'done':
      return grading;
    default:
      return { phase: status.step, detail: '', judging, you };
  }
}

export function needs(s: Snapshot): Need[] {
  const out: Need[] = [];
  const p = s.pipeline;
  if (p?.state === 'running' && p.status) {
    if (p.status.step === 'waiting for your approval') out.push({ kind: 'approve', workflowId: p.workflowId, tickets: p.status.tickets });
    if (p.status.step === 'waiting for your merge decision') {
      out.push({ kind: 'merge', workflowId: p.workflowId, branches: p.status.approvedBranches, review: p.status.review, problem: p.status.mergeProblem });
    }
    if (p.status.question) out.push({ kind: 'answer', workflowId: p.workflowId, question: p.status.question });
  }
  for (const loop of s.loops) {
    if (loop.question) out.push({ kind: 'answer', workflowId: loop.workflowId, ticket: loop.ticket, question: loop.question });
  }
  for (const other of s.others) {
    if (other.question) out.push({ kind: 'answer', workflowId: other.workflowId, question: other.question });
  }
  for (const w of [p, ...s.loops, ...s.others]) {
    if (w?.state !== 'failed' && w?.trouble) out.push({ kind: 'stuck', workflowId: w.workflowId, reason: w.trouble });
  }
  if (p?.state === 'failed') out.push({ kind: 'failed', workflowId: p.workflowId, reason: p.failure ?? 'it failed' });
  for (const loop of s.loops) {
    if (loop.state === 'failed') out.push({ kind: 'failed', workflowId: loop.workflowId, reason: loop.failure ?? 'it failed' });
  }
  return out;
}

// The banner line for a need
export function describe(need: Need): string {
  switch (need.kind) {
    case 'approve':
      return `Approve the tickets dispatch picked: ${need.tickets.join(', ') || 'none'}`;
    case 'merge':
      return `Decide whether to merge ${need.branches.join(', ') || 'nothing'}`;
    case 'answer':
      return `${need.ticket ?? need.workflowId} · the judge asks: "${need.question}"`;
    case 'failed':
      return `${need.workflowId} failed: ${need.reason}`;
    case 'stuck':
      return `${need.workflowId} is stuck: ${need.reason}`;
  }
}

// The four stages of the pipeline, the boxes of the Lab 12 diagram, each with its skill in .agents/skills/.
// A stage covers one or more of the pipeline's steps, see STAGE_OF.
export const STAGES = [
  { prompt: 'skills/research', title: 'Specification', gate: false, judge: true },
  { prompt: 'skills/plan', title: 'Plan', gate: true, judge: true },
  { prompt: 'skills/implement', title: 'Implementation', gate: false, parallel: true, judge: true },
  { prompt: 'skills/review', title: 'Review and merge', gate: true, judge: false },
];

export type StageState = 'done' | 'running' | 'you' | 'failed' | 'todo';

export interface Stage {
  state: StageState;
  status: string;
}

const STAGE_OF: Record<PipelineStatus['step'], number> = {
  researching: 0,
  planning: 1,
  'waiting for your approval': 1,
  implementing: 2,
  reviewing: 3,
  'waiting for your merge decision': 3,
  merging: 3,
  done: 4,
};

export function stages(p: Pipeline, loops: Loop[]): Stage[] {
  // A finished pipeline without a step it can read, for example one from older code, counts as done
  const step = p.status?.step ?? (p.state === 'done' ? 'done' : 'researching');
  const current = STAGE_OF[step];
  const inPipeline = loops.filter((loop) => loop.workflowId.startsWith(`${p.workflowId}-`));
  return STAGES.map((_, i): Stage => {
    if (i < current) {
      if (i === 1 && p.status) return { state: 'done', status: `✓ ${inPipeline.length} of ${p.status.tickets.length} approved` };
      return { state: 'done', status: '✓ done' };
    }
    if (i > current) return { state: 'todo', status: ['', 'waits for the spec', 'waits for approval', 'waits for the loops'][i] };
    if (p.state === 'failed') return { state: 'failed', status: '✗ failed' };
    if (p.state === 'stopped') return { state: 'todo', status: 'stopped' };
    if (p.state !== 'running') return { state: 'done', status: '✓ done' }; // only a running pipeline has a running stage
    if (step === 'waiting for your approval' || step === 'waiting for your merge decision' || p.status?.question) {
      return { state: 'you', status: '⚑ waiting for you' };
    }
    if (p.trouble) return { state: 'you', status: '⚑ stuck, see why' };
    if (i === 2) {
      const waiting = inPipeline.filter((loop) => loop.state === 'you').length;
      const running = inPipeline.filter((loop) => loop.state === 'running').length;
      // A loop that waits for you makes the whole stage wait for you
      if (waiting) return { state: 'you', status: `⚑ ${waiting} of ${inPipeline.length} need${waiting === 1 ? 's' : ''} you` };
      return { state: 'running', status: `${running} of ${inPipeline.length} running` };
    }
    if (step === 'merging') return { state: 'running', status: 'merging' };
    return { state: 'running', status: ['researching', 'planning', '', 'reviewing'][i] };
  });
}

// Loops that wait for you first, then the running ones, then the rest
export function byUrgency(loops: Loop[]): Loop[] {
  const rank: Record<State, number> = { you: 0, failed: 1, running: 2, stopped: 3, done: 4 };
  return [...loops].sort((a, b) => rank[a.state] - rank[b.state] || ticketNumber(a.ticket) - ticketNumber(b.ticket));
}

export function ticketNumber(ticket: string): number {
  return Number(/\d+/.exec(ticket)?.[0] ?? 0);
}

// What needs you comes first, on the left
export const COLUMNS = ['Needs you', 'Backlog', 'Ready', 'Running', 'Done'] as const;
export type Column = (typeof COLUMNS)[number];

export interface Card {
  ticket: Ticket;
  column: Column;
  note: string;
}

// The board: the files in backlog/, moved by what their loops are doing
export function board(s: Snapshot): Card[] {
  const toApprove = new Set(needs(s).flatMap((need) => (need.kind === 'approve' ? need.tickets : [])));
  return s.backlog.map((ticket): Card => {
    const loop = s.loops.find((l) => l.ticket === ticket.id);
    if (toApprove.has(ticket.id)) return { ticket, column: 'Needs you', note: 'approve?' };
    if (loop?.state === 'you') return { ticket, column: 'Needs you', note: loop.question ? 'judge asks' : 'stuck' };
    if (loop?.state === 'failed') return { ticket, column: 'Needs you', note: 'loop failed' };
    if (loop?.state === 'running') return { ticket, column: 'Running', note: `run ${loop.run ?? 1}` };
    if (loop?.state === 'done' && inReview(s)) return { ticket, column: 'Done', note: 'in review' };
    // Its branch waits for you to merge it
    if (loop?.state === 'done' && loop.merged === false) return { ticket, column: 'Needs you', note: 'ready to merge' };
    if (loop?.state === 'done') return { ticket, column: 'Done', note: loop.merged ? 'merged' : 'loop done' };
    if (ticket.status === 'done') return { ticket, column: 'Done', note: 'done' };
    if (ticket.status === 'ready') return { ticket, column: 'Ready', note: loop?.state === 'stopped' ? 'loop stopped' : 'ready' };
    return { ticket, column: 'Backlog', note: ticket.status || 'no status' };
  });
}

function inReview(s: Snapshot): boolean {
  return s.pipeline?.state === 'running' && ['implementing', 'reviewing', 'waiting for your merge decision'].includes(s.pipeline.status?.step ?? '');
}

// The review agent's verdict per branch: its lines that name a branch
export function verdicts(review: string, branches: string[]): string[] {
  const lines = review.split('\n').map((line) => line.trim());
  return lines.filter((line) => /^agent\/\S+:\s*(APPROVE|REJECT)/.test(line) || branches.some((b) => line.startsWith(`${b}:`)));
}

// Is the judge of this stage checking the agent's work right now?
export function judging(s: Snapshot, stage: number): boolean {
  if (stage === 0 || stage === 1) {
    const status = s.pipeline?.state === 'running' ? s.pipeline.status : undefined;
    return status?.step === ['researching', 'planning'][stage] && status.judging === true;
  }
  if (stage === 2) return s.loops.some((loop) => loop.state === 'running' && loop.judging);
  return false;
}
