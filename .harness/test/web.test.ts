import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PipelineStatus } from '../src/types/pipeline';
import type { EvalsReport, EvalsRun } from '../src/types/evals';
import type { SkillLoadedEvalReport } from '../src/types/skill-loaded-evals';
import type { Snapshot } from '../src/web/view-model';
import { boxStates, briefReason, EVAL_STEPS, evalSteps, evalsGrid, evalsRunAt, judging, marks, needs, notAccepted, pipelineCost, skillGroups, skillTrend, trend } from '../src/web/view-model';
import { newEvalsId } from '../src/lib/results';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { handler } from '../src/web/server';
import { pageState } from '../src/web/state';
import type { TaskView, Workflows } from '../src/web/actions';
import { actions, parseAction } from '../src/web/actions';
import { BOXES } from '../src/workflows/map';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// `flows watch` without Temporal: snapshots in, what it shows out

const status = (step: PipelineStatus['step'], extra: Partial<PipelineStatus> = {}): PipelineStatus => ({
  step,
  tasks: ['TASK-1', 'TASK-3', 'TASK-7'],
  review: '',
  unfinished: [],
  approvedBranches: [],
  merged: [],
  notMerged: [],
  ...extra,
});

const implementing: Snapshot = {
  temporal: true,
  worker: true,
  pipeline: { workflowId: 'pipeline', state: 'running', status: status('implementing') },
  loops: [
    { workflowId: 'pipeline-TASK-1', task: 'TASK-1', state: 'done' },
    { workflowId: 'pipeline-TASK-3', task: 'TASK-3', state: 'running', run: 1 },
    { workflowId: 'pipeline-TASK-7', task: 'TASK-7', state: 'you', run: 3, question: 'Count delays in minutes or as late/on time?' },
  ],
  others: [],
  backlog: [
    { id: 'TASK-1', title: 'Normalize the delay data model', status: 'ready', blockedBy: [] },
    { id: 'TASK-2', title: 'Airline overview dashboard', status: 'blocked', blockedBy: ['TASK-1'] },
    { id: 'TASK-3', title: 'Flight status lookup', status: 'ready', blockedBy: [] },
    { id: 'TASK-4', title: 'Airport reference enrichment', status: 'ready', blockedBy: [] },
    { id: 'TASK-7', title: 'Delayed departures per airport on the dashboard', status: 'ready', blockedBy: [] },
  ],
  log: ['[pipeline-TASK-7] == implement: AMBIGUOUS Count delays in minutes or as late/on time?'],
  evalReports: [],
  skillReports: [],
};

// An evals run of 2 tasks, 3 runs each: `accepted` says which runs were
function evals(evalsId: string, accepted: [boolean[], boolean[]], models = { implement: 'claude-sonnet-5-5' }): EvalsReport {
  const runs: EvalsRun[] = (['min-delay-filter', 'delays-csv'] as const).flatMap((task, t) =>
    accepted[t].map((ok, i) => ({
      task, run: i + 1, accepted: ok, reason: ok ? 'the tests pass with the hidden ones, and the grader approves it' : 'the grader rejects it: filters on an old delay event',
      grading: ok ? undefined : 'It filters on the first event.\nREJECT: filters on an old delay event',
      costUsd: 1.5, durationS: 600, step: 'done' as const, merged: ok ? ['agent/task-1'] : [], skillsCommit: 's', harnessCommit: 'h', models,
    })),
  );
  const ok = runs.filter((r) => r.accepted).length;
  const reliable = [0, 1].filter((t) => accepted[t].every(Boolean)).length;
  return {
    evalsId, startedAt: '', commit: `${evalsId.slice(-4)}abc1234`, skillsCommit: 's', harnessCommit: 'h', tasks: ['min-delay-filter', 'delays-csv'], runs, models,
    quality: { accepted: ok, of: 6 }, reliability: { tasks: reliable, of: 2 }, costUsd: 9, costPerAccepted: ok ? 9 / ok : undefined,
  };
}

const HISTORY = [
  evals('20261014-090000', [[false, false, false], [true, false, true]]), // 2 of 6
  evals('20261015-090000', [[true, false, true], [true, true, true]]), // 5 of 6: 3 more, a real change
  evals('20261016-174500', [[true, true, false], [true, true, true]], { implement: 'claude-opus-5-5' }), // the same: noise, other models
];

// A run of the skill-loaded evals: `loaded` says, per case, in which of its 3 runs the agent loaded the skill
function skillLoadedEvals(evalsId: string, loaded: boolean[][]): SkillLoadedEvalReport {
  const cases = [
    { skill: 'testing', prompt: 'Add an endpoint that returns all flights of one airline.', loads: true },
    { skill: 'testing', prompt: 'Fix the typos in README.md.', loads: false },
    { skill: 'api-design', prompt: 'Return 404 when the airport is unknown.', loads: true },
  ];
  const results = cases.map((c, i) => {
    const runs = loaded[i].map((l) => ({ loaded: l, costUsd: 0.02 }));
    const expected = runs.filter((r) => r.loaded === c.loads).length;
    return { ...c, runs, loaded: runs.filter((r) => r.loaded).length, pass: expected >= 2 };
  });
  return { evalsId, startedAt: '', commit: `${evalsId.slice(-4)}def5678`, skillsCommit: 's', uncommitted: [], results, costUsd: 0.18 };
}

const SKILL_HISTORY = [
  skillLoadedEvals('20261015-120000', [[true, true, true], [false, false, false], [false, false, true]]), // 2 of 3 pass
  skillLoadedEvals('20261016-210000', [[true, true, false], [true, false, false], [true, false, false]]), // 2 of 3: noise
];

test('the current box runs, the ones before are done, the ones after wait', () => {
  const noQuestion = implementing.loops.map((loop) => ({ ...loop, state: loop.state === 'you' ? ('running' as const) : loop.state, question: undefined }));
  assert.deepEqual(boxStates(implementing.pipeline!, noQuestion).map((s) => s.state), ['done', 'done', 'done', 'done', 'done', 'running', 'todo', 'todo', 'todo']);
});

test('a loop that waits for you makes the Implement box wait for you', () => {
  const current = boxStates(implementing.pipeline!, implementing.loops)[5];
  assert.deepEqual(current, { state: 'you', label: '1 of 3 needs you' });
});

test('a checkpoint waits for you', () => {
  const pipeline = { workflowId: 'pipeline', state: 'running' as const, status: status('waiting for your merge decision') };
  assert.deepEqual(boxStates(pipeline, []).map((s) => s.state), ['done', 'done', 'done', 'done', 'done', 'done', 'done', 'you', 'todo']);
  assert.equal(needs({ ...implementing, pipeline, loops: [] })[0].kind, 'decideMerge');
  const specification = { ...pipeline, status: status('waiting for your specification approval') };
  assert.deepEqual(boxStates(specification, []).map((s) => s.state).slice(0, 3), ['done', 'you', 'todo']);
  assert.equal(needs({ ...implementing, pipeline: specification, loops: [] })[0].kind, 'approveSpecification');
});

test('a finished pipeline has no running box, also one whose step it can’t read', () => {
  const { step: _, ...rest } = status('done');
  const fromOlderCode = { ...rest, phase: 'done' } as unknown as PipelineStatus; // its result says `phase`, not `step`
  for (const p of [
    { workflowId: 'pipeline', state: 'done' as const, status: fromOlderCode },
    { workflowId: 'pipeline', state: 'done' as const },
    { workflowId: 'pipeline', state: 'done' as const, status: status('reviewing') },
  ]) {
    assert.deepEqual(new Set(boxStates(p, []).map((s) => s.state)), new Set(['done']));
  }
});

test('needs: the approval, then the judges’ questions, then what failed', () => {
  const snapshot: Snapshot = {
    ...implementing,
    pipeline: { workflowId: 'pipeline', state: 'running', status: status('waiting for your plan approval') },
    loops: [
      { workflowId: 'ralph-TASK-4', task: 'TASK-4', state: 'failed', failure: 'Out of runs: 10 runs without a PASS' },
      ...implementing.loops,
    ],
  };
  assert.deepEqual(needs(snapshot).map((n) => `${n.kind} ${n.workflowId}`), [
    'approvePlan pipeline',
    'answer pipeline-TASK-7',
    'failed ralph-TASK-4',
  ]);
});

test('the judge lights up for the box whose agent it is checking', () => {
  assert.equal(judging(implementing, 5), false);
  const checking = { ...implementing, loops: implementing.loops.map((l) => (l.task === 'TASK-3' ? { ...l, judging: true } : l)) };
  assert.equal(judging(checking, 5), true);
  assert.equal(judging(checking, 6), false);
  const planning: Snapshot = { ...implementing, pipeline: { workflowId: 'pipeline', state: 'running', status: { ...status('planning'), judging: true } } };
  assert.equal(judging(planning, 3), true);
  assert.equal(judging(planning, 2), false);
  const designing: Snapshot = { ...implementing, pipeline: { workflowId: 'pipeline', state: 'running', status: { ...status('designing'), judging: true } } };
  assert.equal(judging(designing, 2), true);
});

test('the trend: a change of less than 3 runs or of 1 task is noise, other models are marked', () => {
  const columns = trend(HISTORY);
  assert.deepEqual(columns.map((c) => [c.label, c.quality, c.reliability, c.modelsChanged]), [
    ['10-14 09:00', 'first', 'first', false],
    ['10-15 09:00', 'better', 'noise', false],
    ['10-16 17:45', 'noise', 'noise', true],
  ]);
  assert.deepEqual(evalsGrid(HISTORY[2]).map((row) => [row.task, row.runs.map((r) => r.accepted)]), [
    ['min-delay-filter', [true, true, false]],
    ['delays-csv', [true, true, true]],
  ]);
});

test('an evals run’s id is when it starts, in UTC, the same for flows evals and flows watch', () => {
  assert.equal(newEvalsId(new Date('2026-10-16T17:45:09.123Z')), '20261016-174509');
});


test('the page state: the map, what needs you, the loops with their titles, and the tasks you can start on their own', () => {
  const state = pageState(implementing, 'lab/orchestration', 'claude');
  assert.equal(state.boxes.length, 9);
  assert.deepEqual(state.boxes.map((b) => b.state), ['done', 'done', 'done', 'done', 'done', 'you', 'todo', 'todo', 'todo']);
  assert.equal(state.boxes[0].model, 'opus');
  assert.equal(state.current, 5);
  assert.deepEqual(state.needs.map((n) => n.text), ['TASK-7 · the judge asks: "Count delays in minutes or as late/on time?"']);
  assert.equal(state.loops[0].task, 'TASK-7'); // the one that needs you first
  assert.equal(state.loops[0].title, 'Delayed departures per airport on the dashboard');
  assert.deepEqual(state.ready.map((t) => t.id), ['TASK-1', 'TASK-4']); // ready, and no loop works on it right now
  assert.equal(state.evals !== undefined, true);
  assert.equal(pageState({ ...implementing, withoutEvals: true }, undefined, 'claude').evals, undefined);
});

test('the page state: the specification waits for you, it was sent back once, and what the agents cost so far', () => {
  const pipeline = { workflowId: 'pipeline', state: 'running' as const, status: status('waiting for your specification approval', { revised: { specification: 1 }, costUsd: 0.5 }) };
  const state = pageState({ ...implementing, pipeline, loops: [] }, undefined, 'copilot');
  assert.deepEqual(state.needs.map((n) => n.kind), ['approveSpecification']);
  assert.equal(state.boxes[1].state, 'you');
  assert.deepEqual(state.pipeline?.revised, { specification: 1 });
  assert.equal(state.pipeline?.cost, 0.5);
  assert.equal(state.agent, 'copilot');
});

test('the page state: the map names the models of the agent you start next', () => {
  const models = (agent: 'claude' | 'copilot') => pageState(implementing, undefined, agent).boxes.map((b) => b.model).filter(Boolean);
  assert.deepEqual(models('claude'), ['opus', 'opus', 'opus', 'sonnet', 'opus']);
  assert.deepEqual(models('copilot'), ['gpt-6.1-sol', 'gpt-6.1-sol', 'gpt-6.1-sol', 'claude-sonnet-5.5', 'gpt-6.1-sol']);
});

test('the page state: the evals trend, the latest runs per task, and the skill-loaded evals', () => {
  const state = pageState({ ...implementing, evalReports: HISTORY, skillReports: SKILL_HISTORY }, undefined, 'claude');
  assert.deepEqual(state.evals?.trend.map((t) => [t.label, t.quality.accepted, t.quality.change, t.modelsChanged]), [
    ['10-14 09:00', 2, 'first', false],
    ['10-15 09:00', 5, 'better', false],
    ['10-16 17:45', 5, 'noise', true],
  ]);
  assert.deepEqual(state.evals?.latest.map((row) => [row.task, row.runs.map((r) => r.accepted)]), [['min-delay-filter', [true, true, false]], ['delays-csv', [true, true, true]]]);
  assert.deepEqual(state.evals?.skills.map((s) => [s.cases, s.of]), [[2, 3], [2, 3]]);
});

test('the skill-loaded cases per skill: a case passes or fails once 2 of its runs agree, a run still running has no mark yet', () => {
  const groups = skillGroups(
    [
      { skill: 'testing', prompt: 'Add an endpoint.', loads: true, runs: [{ loaded: true }, { loaded: false }, { loaded: true }] },
      { skill: 'testing', prompt: 'Fix the typos.', loads: false, runs: [{ loaded: true }, { failure: 'claude exited with code 1' }, null] },
      { skill: 'api-design', prompt: 'Add paging.', loads: true, runs: [{ loaded: true }, null, null] },
    ],
    { testing: 'Use for every task in this repository.' },
    ['.agents/skills/testing/SKILL.md'],
  );
  assert.deepEqual(groups.map((g) => [g.skill, g.description, g.changed, g.passing, g.of]), [
    ['testing', 'Use for every task in this repository.', true, 1, 2],
    ['api-design', undefined, false, 0, 1],
  ]);
  assert.deepEqual(groups[0].cases.map((c) => [c.runs.map((r) => [r.text, r.ok]), c.pass]), [
    [[['loaded', true], ['not loaded', false], ['loaded', true]], true],
    [[['loaded', false], ['failed', false], ['running', undefined]], false],
  ]);
  assert.equal(groups[1].cases[0].pass, undefined);
});

test('why an evals run wasn\'t accepted, and its reason without that', () => {
  const run = (accepted: boolean, reason: string) => ({ accepted, reason }) as EvalsRun;
  const cases: [EvalsRun, string | undefined, string][] = [
    [run(false, 'nothing was merged: the review approved no branch: agent/ticket-1: REJECT, Tests: no test tells the averages apart\nmore'), 'merged', 'Tests: no test tells the averages apart'],
    [run(false, 'the grading judge rejects it: the average is rounded'), 'grader', 'the average is rounded'],
    [run(false, 'the grader rejects it: the average is rounded'), 'grader', 'the average is rounded'],
    [run(false, 'the tests fail with the hidden acceptance tests:\nMinDelayAcceptanceTest'), 'tests', ''],
    [run(false, 'it failed: Stuck'), 'failed', 'Stuck'],
    [run(true, 'the tests pass with the hidden ones, and the grader approves it'), undefined, 'the tests pass with the hidden ones, and the grader approves it'],
  ];
  for (const [r, why, brief] of cases) assert.deepEqual([notAccepted(r), briefReason(r)], [why, brief]);
});

test('where a working evals run is: its step, and what it does there; a checkpoint counts as the agent step before it', () => {
  const at = (step: string, extra: object = {}, loops: { task: string; state: 'running' | 'done' }[] = []) =>
    evalsRunAt({ task: 'delays-csv', run: 1, state: 'running', pipeline: { step, tasks: [], unfinished: [], review: '', approvedBranches: [], merged: [], notMerged: [], ...extra } as PipelineStatus, loops });
  assert.deepEqual(EVAL_STEPS, ['Research', 'Design', 'Plan', 'Implement', 'Review', 'Merge', 'Grade']);
  assert.deepEqual(at('designing', { run: 2 }), { step: 1, doing: 'attempt 2 of 3' });
  assert.deepEqual(at('researching', { judging: true }), { step: 0, doing: 'the judge checks it' });
  assert.deepEqual(at('waiting for your plan approval'), { step: 2, doing: 'passing its checkpoint' });
  assert.deepEqual(at('implementing', {}, [{ task: 'TASK-1', state: 'running' }, { task: 'TASK-2', state: 'done' }]), { step: 3, doing: '2 tasks, 1 working' });
  assert.deepEqual(at('reviewing'), { step: 4, doing: 'working' });
  assert.deepEqual(at('merging'), { step: 5, doing: 'merging' });
  assert.deepEqual(evalsRunAt({ task: 'delays-csv', run: 1, state: 'grading', loops: [] }), { step: 6, doing: 'the grader reads it' });
});

test('how a finished evals run went at each step: its agent steps, then whether it merged and the grader took it', () => {
  const run = (accepted: boolean, reason: string): EvalsRun => ({
    task: 'delays-csv', run: 1, accepted, reason, durationS: 60, step: 'done', merged: [], skillsCommit: 's', harnessCommit: 'h',
    costByRole: { research: 1, design: 1, plan: 1, implement: 1, review: 1 }, rejectedBecause: ['implement: no test'],
  });
  assert.deepEqual(evalSteps(run(true, 'the tests pass')), ['ok', 'ok', 'ok', 're', 'ok', 'ok', 'ok']);
  assert.deepEqual(evalSteps(run(false, 'the grader rejects it: rounded')), ['ok', 'ok', 'ok', 're', 'ok', 'ok', 'fail']);
  assert.deepEqual(evalSteps(run(false, 'nothing was merged: REJECT')), ['ok', 'ok', 'ok', 're', 'ok', 'fail', 'na']);
});

test('the running evals on the page: every run, where the working ones are, and the numbers of the runs done so far', () => {
  const state = pageState({
    ...implementing,
    evals: {
      workflowId: 'evals-20261031-125850',
      status: {
        evalsId: '20261031-125850', costUsd: 12,
        runs: [
          { task: 'delays-csv', run: 1, state: 'done', accepted: true, costUsd: 3 },
          { task: 'delays-csv', run: 2, state: 'done', accepted: false, costUsd: 3 },
          { task: 'delays-csv', run: 3, state: 'grading' },
          { task: 'status-filter', run: 1, state: 'running' },
          { task: 'status-filter', run: 2, state: 'waiting' },
        ],
      },
      runs: [
        { task: 'delays-csv', run: 3, state: 'grading', loops: [] },
        { task: 'status-filter', run: 1, state: 'running', loops: [], pipeline: { step: 'designing', run: 1, costUsd: 0.5 } as PipelineStatus },
      ],
    },
  }, undefined, 'claude');
  const r = state.evals?.running;
  assert.deepEqual([r?.done, r?.of, r?.working, r?.quality, r?.reliability, r?.costPerAccepted], [2, 5, 2, { accepted: 1, of: 2 }, { tasks: 0, of: 0 }, 6]);
  assert.deepEqual(r?.rows.map((row) => [row.task, row.runs.map((run) => [run.state, run.step, run.costUsd])]), [
    ['delays-csv', [['done', undefined, 3], ['done', undefined, 3], ['grading', 6, undefined]]],
    ['status-filter', [['running', 1, 0.5], ['waiting', undefined, undefined]]],
  ]);
});

test('the server answers the page and its files, its state and a task, and sends your actions on', async () => {
  const acted: string[] = [];
  const view = { id: 'TASK-1', content: '# Normalize' } as TaskView;
  const server = http.createServer(handler({
    state: () => pageState(implementing, 'main', 'claude'),
    task: (id) => (id === 'TASK-1' ? view : undefined),
    act: async (body) => {
      acted.push(body);
      parseAction(body); // throws for an action that isn't right, the server answers 400
      return 'Approved.';
    },
  }));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  const post = (body: string) => fetch(`${base}/api/action`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  try {
    assert.match(await (await fetch(`${base}/`)).text(), /<title>flows watch<\/title>[\s\S]*page\.js/);
    assert.match(await (await fetch(`${base}/page.js`)).text(), /function renderPipeline/);
    assert.match((await fetch(`${base}/page.css`)).headers.get('content-type') ?? '', /text\/css/);
    assert.equal((await (await fetch(`${base}/api/state`)).json()).boxes.length, BOXES.length);
    assert.equal((await (await fetch(`${base}/api/task?id=TASK-1`)).json()).content, '# Normalize');
    assert.equal((await fetch(`${base}/api/task?id=TASK-9`)).status, 404);
    const res = await post(JSON.stringify({ kind: 'approveSpecification', workflowId: 'pipeline' }));
    assert.deepEqual(await res.json(), { message: 'Approved.' });
    const bad = await post(JSON.stringify({ kind: 'launchRockets' }));
    assert.equal(bad.status, 400);
    assert.deepEqual(await bad.json(), { message: 'There is no action launchRockets.' });
    assert.equal((await post('not json')).status, 400);
    assert.equal((await post('x'.repeat(200_000))).status, 413);
  } finally {
    server.close();
  }
});

test('an evals run per agent step: passed, sent back by a judge, stopped there, or never got there', () => {
  const run = (extra: Partial<EvalsRun>): EvalsRun => ({
    task: 'delays-csv', run: 1, accepted: true, reason: '', durationS: 60, step: 'done', merged: [], skillsCommit: 's', harnessCommit: 'h',
    costByRole: { research: 0.1, design: 0.1, plan: 0.1, implement: 0.1, review: 0.1 }, ...extra,
  });
  const kinds = (r: EvalsRun) => marks(r).map((m) => m.mark);
  assert.deepEqual(kinds(run({})), ['ok', 'ok', 'ok', 'ok', 'ok']);
  const sentBack = marks(run({ rejectedBecause: ['design: no test for an airline without flights', 'implement: the tests fail', 'implement: still'] }));
  assert.deepEqual(sentBack.map((m) => [m.mark, m.times]), [['ok', 0], ['re', 1], ['ok', 0], ['re', 2], ['ok', 0]]);
  assert.deepEqual(sentBack[1].why, ['no test for an airline without flights']);
  // Stopped in implement: it paid for research, design, plan and implement, not for the review
  const stopped = run({ step: 'failed', reason: 'it failed: Stuck', costByRole: { research: 0.1, design: 0.1, plan: 0.1, implement: 0.1 } });
  assert.deepEqual(kinds(stopped), ['ok', 'ok', 'ok', 'fail', 'na']);
  assert.deepEqual(marks(stopped)[3].why, ['it failed: Stuck']);
  // Without costs, as with Copilot, the step its pipeline got to says how far it got
  assert.deepEqual(kinds(run({ costByRole: undefined, step: 'reviewing' })), ['ok', 'ok', 'ok', 'ok', 'na']);
});

test('every box says what it is on the command line, and every checkpoint you can send back names its checkpoint', () => {
  for (const box of BOXES) {
    assert.ok(box.note, `${box.name} has no note`);
    if (box.who === 'agent') assert.match(box.command, /^flows /, `${box.name} has no command`);
    if (box.sendsBackTo !== undefined) {
      assert.ok(box.checkpoint === 'specification' || box.checkpoint === 'plan', `${box.name} sends back, but to which checkpoint?`);
      assert.ok(box.sendsBack);
      assert.ok(box.sendsBackTo < BOXES.indexOf(box));
    }
  }
});

test('an action is checked before anything happens: its kind, its fields, the task and the agent', () => {
  assert.deepEqual(parseAction('{"kind":"revise","workflowId":"pipeline","on":"plan","feedback":" one task "}'), { kind: 'revise', workflowId: 'pipeline', on: 'plan', feedback: 'one task' });
  assert.deepEqual(parseAction('{"kind":"ralph","task":"TASK-5","runs":1}'), { kind: 'ralph', task: 'TASK-5', runs: 1 });
  assert.throws(() => parseAction('{"kind":"revise","workflowId":"pipeline","on":"merge","feedback":"x"}'), /Only the specification or the plan/);
  assert.throws(() => parseAction('{"kind":"answer","workflowId":"pipeline","text":"  "}'), /needs text/);
  assert.throws(() => parseAction('{"kind":"discard","task":"../../etc"}'), /is not a task/);
  assert.throws(() => parseAction('{"kind":"agent","agent":"gpt"}'), /claude or copilot/);
  assert.throws(() => parseAction('{"kind":"decideMerge","workflowId":"pipeline","yes":"yes"}'), /yes: true or false/);
});

// The actions with fakes: a backlog in a temporary folder, Temporal and git that only say what they were asked
function withActions(s: Snapshot, branches: string[] = []) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'watch-'));
  mkdirSync(path.join(dir, 'backlog'));
  for (const t of s.backlog) writeFileSync(path.join(dir, 'backlog', `${t.id}-x.md`), `# ${t.title}\n`);
  const done: string[] = [];
  const workflows: Workflows = {
    start: async (workflow, workflowId) => void done.push(`start ${workflow} ${workflowId}`),
    signal: async (workflowId, signal, ...args) => void done.push(`signal ${workflowId} ${signal.name} ${JSON.stringify(args)}`),
    remove: async (workflowId) => void done.push(`remove ${workflowId}`),
  };
  const repo = {
    discardBranch: (task: string) => (done.push(`discard ${task}`), 'Threw it away.'),
    mergeIntoYours: async (branch: string) => (done.push(`merge ${branch}`), 'Rebased.'),
    openDiff: (branch: string) => (done.push(`diff ${branch}`), 'Opened.'),
    hasBranch: (task: string) => branches.includes(task),
    evalTasks: async () => [{ id: 'delays-csv', request: '', criteria: '', base: '' }] as never,
    staleWorker: () => null,
  };
  return { ...actions(dir, () => s, workflows, repo, 'claude'), done };
}

test('the actions send the same signals as the commands, and start the same workflows', async () => {
  const { act, done } = withActions(implementing);
  assert.equal(await act({ kind: 'approvePlan', workflowId: 'pipeline', tasks: ['TASK-1'] }), 'Approved: TASK-1');
  await act({ kind: 'revise', workflowId: 'pipeline', on: 'specification', feedback: 'Count cancelled flights' });
  await act({ kind: 'decideMerge', workflowId: 'pipeline', yes: false });
  await act({ kind: 'ralph', task: 'TASK-4', runs: 1 });
  assert.match(await act({ kind: 'evals', task: 'delays-csv' }), /^Started evals-.*: 3 runs\.$/);
  assert.deepEqual(done.slice(0, 4), [
    'signal pipeline approveTasks [["TASK-1"]]',
    'signal pipeline revise ["specification","Count cancelled flights"]',
    'signal pipeline decideMerge [false]',
    'start ralph ralph-TASK-4',
  ]);
  assert.equal(await act({ kind: 'start', request: 'Show delays' }), 'A pipeline is already running.');
});

test('a task offers what you can do with it now, and the server refuses the rest', async () => {
  const s: Snapshot = {
    ...implementing,
    loops: [
      { workflowId: 'pipeline-TASK-1', task: 'TASK-1', state: 'done', merged: false }, // the pipeline's: merge it, never throw it away
      { workflowId: 'ralph-TASK-3', task: 'TASK-3', state: 'stopped' }, // its own, it left a branch: throw it away
    ],
  };
  const { act, task, done } = withActions(s, ['TASK-1', 'TASK-3']);
  assert.deepEqual([task('TASK-1')?.merge, task('TASK-1')?.discard], [true, false]);
  assert.deepEqual([task('TASK-3')?.start, task('TASK-3')?.discard, task('TASK-3')?.branch], [true, true, 'agent/task-3']);
  assert.equal(task('TASK-9'), undefined);
  await assert.rejects(act({ kind: 'discard', task: 'TASK-1' }), /TASK-1 can't be thrown away now/);
  await assert.rejects(act({ kind: 'mergeBranch', task: 'TASK-3' }), /TASK-3 can't be merged now/);
  await assert.rejects(act({ kind: 'ralph', task: 'TASK-2' }), /TASK-2 can't be started now/); // blocked
  assert.equal(await act({ kind: 'discard', task: 'TASK-3' }), 'Threw it away.');
  assert.deepEqual(done, ['remove ralph-TASK-3', 'discard TASK-3']);
});

test('a failed run without costs, as with Copilot, shows its failure at the first step', () => {
  const failed: EvalsRun = { task: 'delays-csv', run: 2, accepted: false, reason: 'it failed: Stuck', durationS: 60, step: 'failed', merged: [], skillsCommit: 's', harnessCommit: 'h' };
  assert.deepEqual(marks(failed).map((m) => m.mark), ['fail', 'na', 'na', 'na', 'na']);
  assert.deepEqual(marks(failed)[0].why, ['it failed: Stuck']);
});
