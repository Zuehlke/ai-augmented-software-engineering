// What the page of `flows watch` gets from /api/state: the snapshot, shaped into the JSON the page draws. Only what
// the page shows: what it means, the box states, the needs, the evals' marks, is worked out in view-model.ts. No I/O here.
import type { Agent } from '../config';
import { AGENT_MODELS, EVAL_RUNS, MODELS } from '../config';
import { BOXES, boxOf, STAGES } from '../workflows/map';
import type { RunningEvals, Snapshot } from './view-model';
import { boxStates, briefReason, byUrgency, describe, EVAL_STEPS, evalSteps, evalsGrid, evalsRunAt, judging, marks, needs, notAccepted, passingCases, pipelineCost, progressOf, skillGroups, skillTrend, trend } from './view-model';

// `evalTasks`: the tasks in .harness/evals/tasks/, which the Evals tab offers to start
export function pageState(s: Snapshot, branch: string | undefined, agent: Agent, evalTasks: string[] = []) {
  const st = boxStates(s.pipeline, s.loops);
  const status = s.pipeline?.status;
  const titles = new Map(s.backlog.map((t) => [t.id, t.title]));
  const busy = new Set(s.loops.filter((l) => l.state === 'running' || l.state === 'you').map((l) => l.task));
  const running = s.pipeline?.state === 'running' && status && status.step !== 'done';
  return {
    temporal: s.temporal,
    worker: s.worker,
    branch,
    agent,
    // The pipeline map: the stages, and each box with its role's model (as the agent you start next runs it), its
    // state and what it says
    stages: STAGES,
    boxes: BOXES.map((box, i) => ({ ...box, model: box.role ? AGENT_MODELS[agent][MODELS[box.role]] : undefined, ...st[i], judging: judging(s, i) })),
    current: running ? boxOf(status.step) : -1, // the box the pipeline is at, -1 when none runs
    pipeline: s.pipeline && { state: s.pipeline.state, run: status?.run, revised: status?.revised ?? {}, specification: status?.specification, cost: pipelineCost(s) },
    // What waits for you, in the order to look at it, each with the line that says so
    needs: needs(s).map((need) => ({ ...need, text: describe(need) })),
    loops: byUrgency(s.loops).map((loop) => ({ ...loop, title: titles.get(loop.task) ?? '' })),
    ready: s.backlog.filter((t) => t.status === 'ready' && !busy.has(t.id)), // the tasks you can start a loop on
    log: s.log,
    evals: s.withoutEvals ? undefined : evalsState(s, evalTasks),
  };
}

export type PageState = ReturnType<typeof pageState>;

// The Evals tab: the trend of every evals, the latest one's runs per task and agent step, the skill-loaded evals
function evalsState(s: Snapshot, tasks: string[]) {
  const latest = s.evalReports.at(-1);
  const latestSkills = s.skillReports.at(-1);
  return {
    tasks,
    runsPerTask: EVAL_RUNS,
    trend: trend(s.evalReports).map(({ report, label, commit, modelsChanged, quality, reliability }) => ({
      label,
      commit,
      modelsChanged,
      quality: { ...report.quality, change: quality },
      reliability: { ...report.reliability, change: reliability },
      firstTimeRight: report.firstTimeRight,
      costPerAccepted: report.costPerAccepted,
      proposals: report.proposals, // the improve agent's, or why it couldn't write them
      costUsd: report.costUsd,
      tasks: report.tasks.length,
      runs: report.runs.length,
    })),
    steps: EVAL_STEPS, // the bar under each run
    latest: evalsGrid(latest).map(({ task, runs }) => ({
      task,
      runs: runs.map((run) => {
        const m = marks(run);
        const sentBack = m.reduce((sum, mark) => sum + mark.times, 0);
        return { run: run.run, accepted: run.accepted, why: notAccepted(run), brief: briefReason(run), sentBack, reason: run.reason, grading: run.grading, costUsd: run.costUsd, durationS: run.durationS, marks: m, steps: evalSteps(run) };
      }),
    })),
    running: s.evals && runningEvals(s.evals),
    // The skill-loaded evals: the trend, and the latest one's cases per skill, with what it checked
    skills: skillTrend(s.skillReports).map(({ report, label, commit, passing }) => ({ label, commit, cases: passingCases(report), of: report.results.length, change: passing, uncommitted: report.uncommitted.length > 0 })),
    latestSkills: latestSkills && {
      commit: latestSkills.commit.slice(0, 7),
      uncommitted: latestSkills.uncommitted,
      costUsd: latestSkills.costUsd,
      runs: latestSkills.results.reduce((sum, result) => sum + result.runs.length, 0),
      groups: skillGroups(latestSkills.results, latestSkills.descriptions, latestSkills.uncommitted),
    },
    runningSkills: s.skillLoadedEvals && {
      workflowId: s.skillLoadedEvals.workflowId,
      status: s.skillLoadedEvals.status && { ...s.skillLoadedEvals.status, cases: undefined },
      groups: skillGroups(s.skillLoadedEvals.status?.cases ?? []),
    },
    proposals: { e2e: latest?.proposals, skills: latestSkills?.proposals },
  };
}

// The evals that runs right now: every run, where the working ones are, and the numbers of the runs done so far.
// First time right needs each run's report, so it shows once the evals is done.
function runningEvals(e: RunningEvals) {
  const all = e.status?.runs ?? [];
  const working = new Map(e.runs.map((p) => [`${p.task} ${p.run}`, p]));
  const tasks = [...new Set(all.map((r) => r.task))];
  const done = all.filter((r) => r.state === 'done');
  const accepted = done.filter((r) => r.accepted).length;
  const finished = tasks.filter((task) => all.filter((r) => r.task === task).every((r) => r.state === 'done'));
  const cost = done.reduce<number | null>((sum, r) => (sum === null || r.costUsd == null ? null : sum + r.costUsd), 0);
  return {
    workflowId: e.workflowId,
    done: done.length,
    of: all.length,
    working: all.filter((r) => r.state === 'running' || r.state === 'grading').length,
    costUsd: e.status?.costUsd,
    quality: { accepted, of: done.length },
    reliability: { tasks: finished.filter((task) => all.filter((r) => r.task === task).every((r) => r.accepted)).length, of: finished.length },
    costPerAccepted: accepted && cost !== null ? cost / accepted : undefined,
    rows: tasks.map((task) => ({
      task,
      runs: all.filter((r) => r.task === task).sort((a, b) => a.run - b.run).map((r) => {
        const p = working.get(`${task} ${r.run}`);
        return { run: r.run, state: r.state, accepted: r.accepted, costUsd: r.costUsd ?? p?.pipeline?.costUsd, ...(p && { ...evalsRunAt(p), you: progressOf(p).you }) };
      }),
    })),
  };
}
