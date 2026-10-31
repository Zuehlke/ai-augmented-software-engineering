// What `flows watch` shows, worked out from a snapshot of Temporal and backlog/. No I/O here.
import type { PipelineStatus, Task } from '../types/pipeline';
import { BOXES, boxOf } from '../workflows/map';
import type { EvalsReport, EvalsRun, EvalsStatus } from '../types/evals';
import type { SkillLoadedEvalCase, SkillLoadedEvalReport, SkillLoadedEvalRun, SkillLoadedEvalsStatus } from '../types/skill-loaded-evals';
import { asExpected } from '../types/skill-loaded-evals';

// running: an agent works on it. you: it waits for a person. failed: it stopped with an error.
// done: finished. stopped: finished without being done (out of runs, or stopped by `flows cleanup`).
export type State = 'running' | 'you' | 'failed' | 'done' | 'stopped';

// One Ralph loop: `pipeline-<task>` in the pipeline (Lab 12), `ralph-<task>` on its own (Labs 10, 11)
export interface Loop {
  workflowId: string;
  task: string;
  state: State;
  run?: number;
  question?: string;
  judging?: boolean;
  failure?: string;
  trouble?: string;
  merged?: boolean; // whether its branch agent/<task> is merged, once it's done. Unset if the branch is gone.
  costUsd?: number | null; // what its agent runs cost so far
}

export interface Pipeline {
  workflowId: string;
  state: State;
  status?: PipelineStatus; // from its `status` query while it runs, from its result once it's done
  failure?: string;
  trouble?: string;
}

// Any other workflow, for example `plan`, or `evals` (Lab 13)
export interface Other {
  workflowId: string;
  state: State;
  question?: string;
  trouble?: string;
}

export type { Task };

// One run of the running evals while it works: where its pipeline is, and its Ralph loops
export interface EvalsProgress {
  task: string;
  run: number;
  state: EvalsStatus['runs'][number]['state'];
  pipeline?: PipelineStatus; // from its `status` query while it runs, from its result once it's done
  loops: { task: string; state: State; run?: number; judging?: boolean; costUsd?: number | null }[];
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
  backlog: Task[];
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
function labelOf(evalsId: string): string {
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

// The cases of a skill-loaded evals, per skill, as the Evals tab shows them: each run loaded the skill or not, and
// whether that's what the case expects. A run that is null still runs. A case passes when 2 of its 3 runs do what
// it expects, and fails when 2 don't; until then it has no verdict.
export interface SkillCaseRow {
  prompt: string;
  loads: boolean;
  runs: { text: 'loaded' | 'not loaded' | 'failed' | 'running'; ok?: boolean; failure?: string }[];
  pass?: boolean;
}

export interface SkillGroup {
  skill: string;
  description?: string; // as it was checked
  changed: boolean; // its SKILL.md had changes not committed
  passing: number;
  of: number;
  cases: SkillCaseRow[];
}

export function skillGroups(
  cases: (SkillLoadedEvalCase & { runs: (SkillLoadedEvalRun | null)[] })[],
  descriptions: Record<string, string> = {},
  uncommitted: string[] = [],
): SkillGroup[] {
  const groups = new Map<string, SkillGroup>();
  for (const { skill, prompt, loads, runs } of cases) {
    let group = groups.get(skill);
    if (!group) {
      group = { skill, description: descriptions[skill], changed: uncommitted.includes(`.agents/skills/${skill}/SKILL.md`), passing: 0, of: 0, cases: [] };
      groups.set(skill, group);
    }
    const shown = runs.map((run): SkillCaseRow['runs'][number] => {
      if (!run) return { text: 'running' };
      if (run.loaded === undefined) return { text: 'failed', ok: false, failure: run.failure };
      return { text: run.loaded ? 'loaded' : 'not loaded', ok: asExpected(run, loads) };
    });
    const right = shown.filter((run) => run.ok === true).length;
    const wrong = shown.filter((run) => run.ok === false).length;
    const pass = right >= 2 ? true : wrong >= 2 ? false : undefined;
    group.cases.push({ prompt, loads, runs: shown, pass });
    group.of++;
    if (pass) group.passing++;
  }
  return [...groups.values()];
}

// Why an evals run wasn't accepted, from its reason: see grade in workflows/evals.ts
export type NotAccepted = 'merged' | 'tests' | 'grader' | 'failed';

export function notAccepted(run: EvalsRun): NotAccepted | undefined {
  if (run.accepted) return undefined;
  if (run.reason.startsWith('nothing was merged')) return 'merged';
  if (run.reason.startsWith('the tests fail')) return 'tests';
  if (/^the grad(er|ing judge) rejects/.test(run.reason)) return 'grader'; // older evals called the grader the grading judge
  return 'failed';
}

// The first line of why a run wasn't accepted, without what notAccepted already says
export function briefReason(run: EvalsRun): string {
  const line = run.reason.split('\n')[0];
  return line
    .replace(/^nothing was merged: (the review approved no branch: )?([\w/.-]+: )?(REJECT,?\s*)?/, '')
    .replace(/^the grad(er|ing judge) rejects it: /, '')
    .replace(/^the tests fail with the hidden acceptance tests:?/, '')
    .replace(/^it failed: /, '')
    .trim();
}

// The runs of the latest evals, one row per task, the runs in order
export function evalsGrid(report: EvalsReport | undefined): { task: string; runs: EvalsRun[] }[] {
  if (!report) return [];
  return report.tasks.map((task) => ({ task, runs: report.runs.filter((run) => run.task === task).sort((a, b) => a.run - b.run) }));
}

// The agent steps of the map, the columns of the evals' grid
export const AGENT_STEPS = BOXES.filter((box) => box.who === 'agent').map((box) => box.role!);

export interface Mark {
  mark: 'ok' | 're' | 'fail' | 'na';
  times: number; // how often a judge or a plain-code check sent it back
  why: string[];
}

// What happened to an evals run at each agent step: ok, it passed the first time; re, a judge or a plain-code check
// rejected it, then it passed; fail, the run stopped there; na, it never got there. The steps it got to are the
// roles it paid for, or, without costs (Copilot), the step its pipeline got to. A run that failed without costs
// only says that it failed: it shows at the first step.
export function marks(run: EvalsRun): Mark[] {
  const order = BOXES.map((box) => box.role);
  const reachedByStep = run.step === 'failed' ? 1 : boxOf(run.step);
  const reached = AGENT_STEPS.map((role) => (run.costByRole ? run.costByRole[role] !== undefined : order.indexOf(role) < reachedByStep));
  const last = reached.lastIndexOf(true);
  return AGENT_STEPS.map((role, i): Mark => {
    const why = (run.rejectedBecause ?? []).filter((reason) => reason.startsWith(`${role}:`)).map((reason) => reason.slice(role.length + 1).trim());
    if (!reached[i]) return { mark: 'na', times: 0, why };
    if (run.step === 'failed' && i === last) return { mark: 'fail', times: why.length, why: why.length ? why : [run.reason] };
    return { mark: why.length ? 're' : 'ok', times: why.length, why };
  });
}

// The steps of an evals run, the bar under each run in the Evals tab: the pipeline's agent steps, its merge, the grading
export const EVAL_STEPS = [...AGENT_STEPS.map((role) => BOXES.find((box) => box.role === role)!.name), 'Merge', 'Grade'];
const MERGE = EVAL_STEPS.length - 2;
const GRADE = EVAL_STEPS.length - 1;

// Where a working evals run is: its step in EVAL_STEPS, and what it does there. At a checkpoint, which the evals
// passes by itself, it is still at the agent step before it.
export function evalsRunAt(p: EvalsProgress): { step: number; doing: string } {
  if (p.state === 'grading' || p.pipeline?.step === 'done') return { step: GRADE, doing: 'the grader reads it' };
  const status = p.pipeline;
  if (!status) return { step: 0, doing: 'starting' };
  const i = boxOf(status.step);
  if (i >= BOXES.length) return { step: 0, doing: status.step };
  if (BOXES[i].name === 'Merge') return { step: MERGE, doing: status.step };
  const agent = BOXES.slice(0, i + 1).reverse().find((box) => box.who === 'agent')!;
  const step = AGENT_STEPS.indexOf(agent.role!);
  if (agent.role === 'implement') {
    const working = p.loops.filter((loop) => loop.state === 'running').length;
    return { step, doing: `${p.loops.length} ${p.loops.length === 1 ? 'task' : 'tasks'}, ${working} working` };
  }
  if (agent !== BOXES[i]) return { step, doing: 'passing its checkpoint' };
  if (status.judging) return { step, doing: 'the judge checks it' };
  return { step, doing: agent.runs ? `attempt ${status.run ?? 1} of ${agent.runs}` : 'working' };
}

// How a finished evals run went at each of EVAL_STEPS: the agent steps' marks, then whether it merged and was graded
export function evalSteps(run: EvalsRun): Mark['mark'][] {
  const agentMarks = marks(run).map((m) => m.mark);
  const why = notAccepted(run);
  if (why === 'failed') return [...agentMarks, 'na', 'na'];
  if (why === 'merged') return [...agentMarks, 'fail', 'na'];
  return [...agentMarks, 'ok', run.accepted ? 'ok' : 'fail'];
}

// What waits for a person, in the order they should look at it
export type Need =
  | { kind: 'approveSpecification'; workflowId: string }
  | { kind: 'approvePlan'; workflowId: string; tasks: string[] }
  | { kind: 'decideMerge'; workflowId: string; branches: string[]; verdicts: string[]; problem?: string }
  | { kind: 'answer'; workflowId: string; task?: string; question: string }
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

// Where a run of the running evals is: its phase, and whether it waits for you
export function progressOf(p: EvalsProgress): { phase: string; you: boolean } {
  if (p.state === 'grading' || p.pipeline?.step === 'done') return { phase: 'grading', you: false };
  const status = p.pipeline;
  if (!status) return { phase: 'starting', you: false };
  const you = status.step.startsWith('waiting for your') || p.loops.some((loop) => loop.state === 'you');
  return { phase: status.step, you };
}

export function needs(s: Snapshot): Need[] {
  const out: Need[] = [];
  const p = s.pipeline;
  if (p?.state === 'running' && p.status) {
    if (p.status.step === 'waiting for your specification approval') out.push({ kind: 'approveSpecification', workflowId: p.workflowId });
    if (p.status.step === 'waiting for your plan approval') out.push({ kind: 'approvePlan', workflowId: p.workflowId, tasks: p.status.tasks });
    if (p.status.step === 'waiting for your merge decision') {
      const { approvedBranches: branches, review, mergeProblem: problem } = p.status;
      out.push({ kind: 'decideMerge', workflowId: p.workflowId, branches, verdicts: verdicts(review, branches), problem });
    }
    if (p.status.question) out.push({ kind: 'answer', workflowId: p.workflowId, question: p.status.question });
  }
  for (const loop of s.loops) {
    if (loop.question) out.push({ kind: 'answer', workflowId: loop.workflowId, task: loop.task, question: loop.question });
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
    case 'approveSpecification':
      return 'Approve the specification, or send it back with feedback';
    case 'approvePlan':
      return `Approve the plan and the tasks dispatch picked, or send it back with feedback: ${need.tasks.join(', ') || 'none'}`;
    case 'decideMerge':
      return `Decide whether to merge ${need.branches.join(', ') || 'nothing'}`;
    case 'answer':
      return `${need.task ?? need.workflowId} · the judge asks: "${need.question}"`;
    case 'failed':
      return `${need.workflowId} failed: ${need.reason}`;
    case 'stuck':
      return `${need.workflowId} is stuck: ${need.reason}`;
  }
}

export type StageState = 'done' | 'running' | 'you' | 'failed' | 'todo';

// A box of the pipeline map: its state, and what it says under its name
export interface BoxState {
  state: StageState;
  label: string;
}

// Each box of BOXES, as the pipeline is at. Without a pipeline, all of them wait.
export function boxStates(p: Pipeline | undefined, loops: Loop[]): BoxState[] {
  const todo = (i: number): BoxState => ({ state: 'todo', label: BOXES[i].who === 'you' ? 'you decide' : '' });
  if (!p) return BOXES.map((_, i) => todo(i));
  // A finished pipeline is done, also one whose step it can't read, for example one from older code
  if (p.state === 'done') return BOXES.map(() => ({ state: 'done', label: 'done' }));
  const step = p.status?.step ?? 'researching';
  const current = boxOf(step);
  const inPipeline = loops.filter((loop) => loop.workflowId.startsWith(`${p.workflowId}-`));
  return BOXES.map((box, i): BoxState => {
    if (i < current) {
      if (box.name === 'Plan' && box.who === 'you' && p.status) return { state: 'done', label: `${inPipeline.length} of ${p.status.tasks.length} approved` };
      return { state: 'done', label: box.who === 'you' ? 'approved' : 'done' };
    }
    if (i > current) return todo(i);
    if (p.state === 'failed') return { state: 'failed', label: 'failed' };
    if (p.state === 'stopped') return { state: 'todo', label: 'stopped' };
    if (p.state !== 'running') return { state: 'done', label: 'done' }; // only a running pipeline has a running box
    if (box.who === 'you' || p.status?.question) return { state: 'you', label: p.status?.question ? 'the judge asks' : 'you decide' };
    if (p.trouble) return { state: 'you', label: 'stuck, see why' };
    if (box.role === 'implement') {
      const waiting = inPipeline.filter((loop) => loop.state === 'you').length;
      const running = inPipeline.filter((loop) => loop.state === 'running').length;
      // A loop that waits for you makes the whole box wait for you
      if (waiting) return { state: 'you', label: `${waiting} of ${inPipeline.length} need${waiting === 1 ? 's' : ''} you` };
      return { state: 'running', label: `${running} of ${inPipeline.length} running` };
    }
    const run = box.runs && p.status?.run ? `${p.status.run}/${box.runs}` : step;
    return { state: 'running', label: run };
  });
}

// Loops that wait for you first, then the running ones, then the rest
export function byUrgency(loops: Loop[]): Loop[] {
  const rank: Record<State, number> = { you: 0, failed: 1, running: 2, stopped: 3, done: 4 };
  return [...loops].sort((a, b) => rank[a.state] - rank[b.state] || taskNumber(a.task) - taskNumber(b.task));
}

function taskNumber(task: string): number {
  return Number(/\d+/.exec(task)?.[0] ?? 0);
}

// The review agent's verdict per branch, its lines that name a branch. Without such lines, the end of what it says.
function verdicts(review: string, branches: string[]): string[] {
  const lines = review.split('\n').map((line) => line.trim());
  const named = lines.filter((line) => /^agent\/\S+:\s*(APPROVE|REJECT)/.test(line) || branches.some((b) => line.startsWith(`${b}:`)));
  return named.length ? named : lines.filter(Boolean).slice(-6);
}

// Is the judge of this box checking the agent's work right now?
export function judging(s: Snapshot, box: number): boolean {
  if (BOXES[box]?.role === 'implement') return s.loops.some((loop) => loop.state === 'running' && loop.judging);
  const status = s.pipeline?.state === 'running' ? s.pipeline.status : undefined;
  return !!status && boxOf(status.step) === box && status.judging === true && !!BOXES[box].check;
}
