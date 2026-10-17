import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PipelineStatus } from '../src/types/pipeline';
import type { EvalsReport, EvalsRun } from '../src/types/evals';
import type { SkillLoadedEvalReport } from '../src/types/skill-loaded-evals';
import type { Snapshot } from '../src/watch/model';
import { evalsGrid, board, judging, needs, pipelineCost, skillTrend, stages, trend } from '../src/watch/model';
import { newEvalsId } from '../src/results';
import type { Ui } from '../src/watch/view';
import { nextView, render } from '../src/watch/view';
import { evalsChoices, evalsKindOf, latestProposals, moveRun, selectedRun } from '../src/watch/view/evals';
import { markdown } from '../src/watch/view/markdown';
import { BOLD, DIM, splitToWidth } from '../src/watch/grid';

// `flows watch` without Temporal: snapshots in, what it shows out

const status = (step: PipelineStatus['step'], extra: Partial<PipelineStatus> = {}): PipelineStatus => ({
  step,
  tickets: ['TICKET-1', 'TICKET-3', 'TICKET-7'],
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
    { workflowId: 'pipeline-TICKET-1', ticket: 'TICKET-1', state: 'done' },
    { workflowId: 'pipeline-TICKET-3', ticket: 'TICKET-3', state: 'running', run: 1 },
    { workflowId: 'pipeline-TICKET-7', ticket: 'TICKET-7', state: 'you', run: 3, question: 'Count delays in minutes or as late/on time?' },
  ],
  others: [],
  backlog: [
    { id: 'TICKET-1', title: 'Normalize the delay data model', status: 'ready', blockedBy: [] },
    { id: 'TICKET-2', title: 'Airline overview dashboard', status: 'blocked', blockedBy: ['TICKET-1'] },
    { id: 'TICKET-3', title: 'Flight status lookup', status: 'ready', blockedBy: [] },
    { id: 'TICKET-4', title: 'Airport reference enrichment', status: 'ready', blockedBy: [] },
    { id: 'TICKET-7', title: 'Delayed departures per airport on the dashboard', status: 'ready', blockedBy: [] },
  ],
  log: ['[pipeline-TICKET-7] == implement: AMBIGUOUS Count delays in minutes or as late/on time?'],
  evalReports: [],
  skillReports: [],
};

test('the current stage runs, the ones before are done, the ones after wait', () => {
  const noQuestion = implementing.loops.map((loop) => ({ ...loop, state: loop.state === 'you' ? ('running' as const) : loop.state, question: undefined }));
  assert.deepEqual(stages(implementing.pipeline!, noQuestion).map((s) => s.state), ['done', 'done', 'running', 'todo']);
});

test('a loop that waits for you makes its stage wait for you', () => {
  const current = stages(implementing.pipeline!, implementing.loops)[2];
  assert.deepEqual(current, { state: 'you', status: '⚑ 1 of 3 needs you' });
});

test('a gateway waits for you', () => {
  const pipeline = { workflowId: 'pipeline', state: 'running' as const, status: status('waiting for your merge decision') };
  assert.deepEqual(stages(pipeline, []).map((s) => s.state), ['done', 'done', 'done', 'you']);
  assert.equal(needs({ ...implementing, pipeline, loops: [] })[0].kind, 'merge');
});

test('a finished pipeline has no running stage, also one whose step it can’t read', () => {
  const { step: _, ...rest } = status('done');
  const fromOlderCode = { ...rest, phase: 'done' } as unknown as PipelineStatus; // its result says `phase`, not `step`
  for (const p of [
    { workflowId: 'pipeline', state: 'done' as const, status: fromOlderCode },
    { workflowId: 'pipeline', state: 'done' as const },
    { workflowId: 'pipeline', state: 'done' as const, status: status('reviewing') },
  ]) {
    assert.deepEqual(stages(p, []).map((s) => s.state), ['done', 'done', 'done', 'done']);
  }
});

test('needs: the approval, then the judges’ questions, then what failed', () => {
  const snapshot: Snapshot = {
    ...implementing,
    pipeline: { workflowId: 'pipeline', state: 'running', status: status('waiting for your approval') },
    loops: [
      { workflowId: 'ralph-TICKET-4', ticket: 'TICKET-4', state: 'failed', failure: 'Out of runs: 10 runs without a PASS' },
      ...implementing.loops,
    ],
  };
  assert.deepEqual(needs(snapshot).map((n) => `${n.kind} ${n.workflowId}`), [
    'approve pipeline',
    'answer pipeline-TICKET-7',
    'failed ralph-TICKET-4',
  ]);
});

test('the board moves the tickets by what their loops do', () => {
  const columns = Object.fromEntries(board(implementing).map((card) => [card.ticket.id, card.column]));
  assert.deepEqual(columns, {
    'TICKET-1': 'Done',
    'TICKET-2': 'Backlog',
    'TICKET-3': 'Running',
    'TICKET-4': 'Ready',
    'TICKET-7': 'Needs you',
  });
});

test('a finished loop whose branch isn’t merged needs you', () => {
  const finished = (merged?: boolean): Snapshot => ({
    ...implementing,
    pipeline: undefined,
    loops: [{ workflowId: 'ralph-TICKET-1', ticket: 'TICKET-1', state: 'done', merged }],
  });
  const card = (s: Snapshot) => board(s).find((c) => c.ticket.id === 'TICKET-1');
  assert.deepEqual(card(finished(false)), { ticket: implementing.backlog[0], column: 'Needs you', note: 'ready to merge' });
  assert.deepEqual(card(finished(true)), { ticket: implementing.backlog[0], column: 'Done', note: 'merged' });
  assert.deepEqual(card(finished(undefined)), { ticket: implementing.backlog[0], column: 'Done', note: 'loop done' });
});

test('⏎ on a card that isn’t merged guides through the merge', () => {
  const s: Snapshot = { ...implementing, pipeline: undefined, loops: [{ workflowId: 'ralph-TICKET-1', ticket: 'TICKET-1', state: 'done', merged: false }] };
  const ui = { view: 'board' as const, need: 0, column: 0, scroll: [], cursor: [], stage: 0, tick: 0 };
  assert.match(render(s, ui, 126, 40).plain(), /⏎ open ticket/);
  const preview = { ticket: 'TICKET-1', title: 'Normalize the delay data model', branch: 'agent/ticket-1', commits: ['Add the delay model'], stat: '1 file changed', conflicts: false, uncommitted: [] };
  for (const [width, height] of [[80, 24], [126, 40]]) {
    const text = render(s, { ...ui, dialog: { kind: 'mergeBranch', preview, into: 'main' } }, width, height).plain();
    assert.ok(text.split('\n').every((line) => [...line].length <= width));
    assert.match(text, /Merge TICKET-1/);
    assert.match(text, /agent\/ticket-1 has 1 commit that main doesn't have/);
    assert.match(text, /y rebase/);
    assert.match(text, /d diff in IDE/);
  }
  const conflicting = render(s, { ...ui, dialog: { kind: 'mergeBranch', preview: { ...preview, conflicts: true }, into: 'main' } }, 126, 40).plain();
  assert.match(conflicting, /It conflicts with main/);
  assert.doesNotMatch(conflicting, /y rebase/);
});

const ticketFile = `---
id: TICKET-1
status: ready
---

# Normalize the delay data model

Delays are stored once, in minutes, so every
lookup counts them the same way.

## Acceptance Criteria

- A delay is stored in minutes, never as late or
  on time.
- Old data is migrated.
`;

test('a ticket’s Markdown: the status, headings, and paragraphs and list items wrapped again', () => {
  assert.deepEqual(markdown(ticketFile, 40).map(([line]) => line), [
    'status: ready',
    '',
    'Normalize the delay data model',
    '',
    'Delays are stored once, in minutes, so',
    'every lookup counts them the same way.',
    '',
    'Acceptance Criteria',
    '',
    '• A delay is stored in minutes, never as',
    '  late or on time.',
    '• Old data is migrated.',
  ]);
});

test('an agent’s Markdown: no bold or code marks, bold lines on their own, nested items, long code wrapped', () => {
  const proposal = [
    '## 1. Keep the value exact',
    '',
    '**Why:** All runs rounded `avg`.',
    '**File:** `SKILL.md`',
    '',
    '**What’s right**',
    '- one',
    '  - nested',
    '```',
    '   - an assumption never changes a value the request defines',
    '```',
  ].join('\n');
  assert.deepEqual(markdown(proposal, 40), [
    ['1. Keep the value exact', BOLD],
    ['', {}],
    ['Why: All runs rounded avg.', {}],
    ['File: SKILL.md', {}],
    ['', {}],
    ['What’s right', BOLD],
    ['• one', {}],
    ['  • nested', {}],
    ['     - an assumption never changes a', DIM],
    ['     value the request defines', DIM],
  ]);
});

test('⏎ on a card shows its ticket, with what you can do with it', () => {
  const ui = { view: 'board' as const, need: 0, column: 0, scroll: [], cursor: [], stage: 0, tick: 0 };
  const ticket = implementing.backlog[0];
  for (const [width, height] of [[80, 24], [126, 40]]) {
    const text = render(implementing, { ...ui, dialog: { kind: 'ticket', ticket, content: ticketFile, scroll: 0, start: true, merge: false } }, width, height).plain();
    assert.ok(text.split('\n').every((line) => [...line].length <= width));
    assert.match(text, /TICKET-1/);
    assert.match(text, /• A delay is stored in minutes/);
    assert.match(text, /s start/);
    assert.doesNotMatch(text, /m merge/);
  }
  // Too long for a small terminal: it scrolls, and never past the end
  const dialog = { kind: 'ticket' as const, ticket, content: ticketFile, scroll: 99, start: false, merge: true };
  const text = render(implementing, { ...ui, dialog }, 80, 12).plain();
  assert.match(text, /↑↓ scroll/);
  assert.match(text, /• Old data is migrated\./);
  assert.match(text, /m merge/);
  assert.equal(dialog.scroll, markdown(ticketFile, 80 - 4 - 6).length - (12 - 2 - 5));
});

test('the worker output wraps to the terminal and scrolls back, held still while you read', () => {
  const log = Array.from({ length: 60 }, (_, i) => `[pipeline] line ${i}`);
  log.push(`[pipeline]     const indented = ${'x'.repeat(150)}`);
  const ui = { view: 'pipeline' as const, need: 0, column: 0, scroll: [], cursor: [], stage: 0, tick: 0 };
  const following = render({ ...implementing, log }, ui, 100, 40).plain();
  assert.match(following, /\[pipeline\]     const indented = x+/); // spaces kept
  assert.match(following, /^ {4}x+ *$/m); // the rest of the long line on the next row
  assert.doesNotMatch(following, /line 0\b/);
  assert.deepEqual(splitToWidth('abcdef', 4), ['abcd', 'ef']);

  const back = { ...ui, log: { lines: log, scroll: 999 } };
  const scrolled = render({ ...implementing, log: [...log, '[pipeline] newer line'] }, back, 100, 40).plain();
  assert.match(scrolled, /Worker output · \d+ lines back, paused/);
  assert.match(scrolled, /line 0\b/); // as far back as it goes
  assert.doesNotMatch(scrolled, /newer line/); // held still
  assert.match(scrolled, /End follow/);
});

test('every view fits the terminal, from narrow to wide', () => {
  for (const view of ['pipeline', 'board', 'evals'] as const) {
    for (const [width, height] of [[80, 24], [126, 40], [200, 50]]) {
      const text = render({ ...implementing, evalReports: HISTORY }, { view, need: 0, column: 0, scroll: [], cursor: [], stage: 0, tick: 0 }, width, height).plain();
      const lines = text.split('\n');
      assert.equal(lines.length, height);
      assert.ok(lines.every((line) => [...line].length <= width), `${view} at ${width} columns is too wide`);
      assert.match(text, /Needs you .*TICKET-7/);
    }
  }
});

test('with nothing running, nothing waits for you', () => {
  const text = render({ ...implementing, pipeline: undefined, loops: [] }, { view: 'pipeline', need: 0, column: 0, scroll: [], cursor: [], stage: 0, tick: 0 }, 126, 30).plain();
  assert.doesNotMatch(text, /Nothing is running yet/);
  assert.match(text, /Nothing waits for you/);
});

test('without a worker, that is what needs you', () => {
  const text = render({ ...implementing, worker: false }, { view: 'pipeline', need: 0, column: 0, scroll: [], cursor: [], stage: 0, tick: 0 }, 126, 30).plain();
  assert.match(text, /Needs you +The worker isn't running/);
});

test('the colours: soft Zühlke tones on dark terminals, the full ones on light, the text in the terminal’s own colour', () => {
  const grid = render(implementing, { view: 'pipeline', need: 0, column: 0, scroll: [], cursor: [], stage: 0, tick: 0 }, 126, 30);
  assert.match(grid.ansi('dark'), /38;2;178;132;181/); // Purple 75 #B284B5: needs you
  assert.match(grid.ansi('dark'), /38;2;64;179;217/); // Blue 75 #40B3D9: running
  assert.match(grid.ansi('light'), /38;2;152;91;156/); // Purple #985B9C
  assert.match(grid.ansi('light'), /38;2;0;153;204/); // Blue #0099CC
  assert.doesNotMatch(grid.ansi('dark'), /\x1b\[7m/); // no inverted blocks
});

test('an agent that keeps failing makes the pipeline wait for you', () => {
  const pipeline = { workflowId: 'pipeline', state: 'running' as const, status: status('researching'), trouble: 'claude exited with code 1 (runAgent, attempt 3)' };
  const snapshot = { ...implementing, pipeline, loops: [] };
  assert.deepEqual(needs(snapshot)[0], { kind: 'stuck', workflowId: 'pipeline', reason: pipeline.trouble });
  assert.equal(stages(pipeline, [])[0].state, 'you');
  assert.match(render(snapshot, { view: 'pipeline', need: 0, column: 0, scroll: [], cursor: [], stage: 0, tick: 0 }, 126, 30).plain(), /Needs you +pipeline is stuck: claude exited with code 1/);
});

test('the judge lights up for the stage whose agent it is checking', () => {
  assert.equal(judging(implementing, 2), false);
  const checking = { ...implementing, loops: implementing.loops.map((l) => (l.ticket === 'TICKET-3' ? { ...l, judging: true } : l)) };
  assert.equal(judging(checking, 2), true);
  assert.equal(judging(checking, 3), false);
  const planning: Snapshot = { ...implementing, pipeline: { workflowId: 'pipeline', state: 'running', status: { ...status('planning'), judging: true } } };
  assert.equal(judging(planning, 1), true);
  assert.equal(judging(planning, 0), false);
});

test('the pipeline shows what its agents cost so far, its running loops included', () => {
  const pipeline = { ...implementing.pipeline!, status: status('implementing', { costUsd: 1.5 }) };
  const loops = implementing.loops.map((loop, i) => ({ ...loop, costUsd: [0.25, 0.5, 0.25][i] }));
  const snapshot = { ...implementing, pipeline, loops };
  assert.equal(pipelineCost(snapshot), 2.5);
  assert.match(render(snapshot, { view: 'pipeline', need: 0, column: 0, scroll: [], cursor: [], stage: 0, tick: 0 }, 140, 40).plain(), /cost so far \$2\.50/);

  // Once the loops finished, the pipeline's own status has counted them
  const reviewing = { ...snapshot, pipeline: { ...pipeline, status: status('reviewing', { costUsd: 2.75 }) } };
  assert.equal(pipelineCost(reviewing), 2.75);
  // A loop that reports no cost, as with Copilot, makes it unknown
  assert.equal(pipelineCost({ ...snapshot, loops: [{ ...loops[0], costUsd: null }] }), null);
  assert.match(render({ ...snapshot, loops: [{ ...loops[0], costUsd: null }] }, { view: 'pipeline', need: 0, column: 0, scroll: [], cursor: [], stage: 0, tick: 0 }, 140, 40).plain(), /cost so far unknown/);
});

// An evals run of 2 tasks, 3 runs each: `accepted` says which runs were
function evals(evalsId: string, accepted: [boolean[], boolean[]], models = { implement: 'claude-sonnet-5-5' }): EvalsReport {
  const runs: EvalsRun[] = (['min-delay-filter', 'delays-csv'] as const).flatMap((task, t) =>
    accepted[t].map((ok, i) => ({
      task, run: i + 1, accepted: ok, reason: ok ? 'the tests pass with the hidden ones, and the grader approves it' : 'the grader rejects it: filters on an old delay event',
      grading: ok ? undefined : 'It filters on the first event.\nREJECT: filters on an old delay event',
      costUsd: 1.5, durationS: 600, step: 'done' as const, merged: ok ? ['agent/ticket-1'] : [], skillsCommit: 's', harnessCommit: 'h', models,
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

test('the Evals tab shows the trend, the latest evals’s runs, and what the picked run says', () => {
  const ui = { view: 'evals' as const, need: 0, column: 0, scroll: [], cursor: [], stage: 0, tick: 0, evalsRun: 2 };
  const snapshot = { ...implementing, evalReports: HISTORY };
  const text = render(snapshot, ui, 126, 40).plain();
  assert.match(text, /Pipeline {3}Board {3}Evals/);
  assert.match(text, /Trend +10-14 09:00 +10-15 09:00 +10-16 17:45 \*/);
  assert.match(text, /Quality, runs accepted +2 \/ 6 +5 \/ 6 ↑ +5 \/ 6$/m);
  assert.match(text, /Reliability, tasks +0 \/ 2 +1 \/ 2 +1 \/ 2/);
  assert.match(text, /Cost per accepted +\$4\.50 +\$1\.80 +\$1\.80/);
  assert.doesNotMatch(text, /other models than the evals before/);
  assert.match(text, /min-delay-filter +✓ +✓ +✗ +the grader rejects it: filters on an old delay event/);
  assert.match(text, /delays-csv +✓ +✓ +✓ +reliable/);
  assert.match(text, /⏎ details/);
  assert.match(text, /tab pipeline/);

  const withDialog = render(snapshot, { ...ui, dialog: { kind: 'evalsRun', run: HISTORY[2].runs[2] } }, 126, 40).plain();
  assert.match(withDialog, /✗ min-delay-filter, run 3/);
  assert.match(withDialog, /Cost \$1\.50 · 10 min · pipeline: done/);
  assert.match(withDialog, /The grader:/);
  assert.match(withDialog, /It filters on the first event\./);
  assert.doesNotMatch(withDialog, /REJECT:/); // the reason above already says it
});

test('p in the Evals tab shows what the improve agent proposed after the latest e2e and the latest skill-loaded evals', () => {
  const ui = { view: 'evals' as const, need: 0, column: 0, scroll: [], cursor: [], stage: 0, tick: 0 };
  const proposals = '## Test blank values in the implement skill\n\n**Why:** the judge rejected a step without a test for a blank value\n**File:** .agents/skills/implement/SKILL.md\n';
  const snapshot = { ...implementing, evalReports: [...HISTORY.slice(0, 2), { ...HISTORY[2], proposals }] };
  const e2e = { title: 'E2E, 10-16 17:45', text: proposals };
  assert.deepEqual(latestProposals(snapshot), [e2e]);
  assert.deepEqual(latestProposals({ ...snapshot, evalReports: HISTORY }), []);

  const skillProposals = '## Name the tests in the testing skill description\n\n**Why:** the skill didn\'t load for a bug fix\n';
  const both = { ...snapshot, skillReports: [SKILL_HISTORY[0], { ...SKILL_HISTORY[1], proposals: skillProposals }] };
  const skills = { title: 'Skill loaded, 10-16 21:00', text: skillProposals };
  assert.deepEqual(latestProposals(both), [e2e, skills]);
  assert.deepEqual(latestProposals({ ...both, evalReports: HISTORY }), [skills]);

  // The key shows in both sub-views when either has proposals
  assert.match(render(snapshot, ui, 126, 40).plain(), /p proposals/);
  assert.match(render(snapshot, { ...ui, evalsKind: 'skillLoaded' }, 126, 40).plain(), /p proposals/);
  assert.doesNotMatch(render({ ...snapshot, evalReports: HISTORY }, ui, 126, 40).plain(), /p proposals/);

  const dialog = render(both, { ...ui, dialog: { kind: 'proposals', sections: latestProposals(both), scroll: 0 } }, 126, 40).plain();
  assert.match(dialog, / Proposals /);
  assert.match(dialog, /── After E2E, 10-16 17:45 ─+/);
  assert.match(dialog, /Test blank values in the implement skill/);
  assert.match(dialog, /the judge rejected a step without a test for a blank value/);
  assert.match(dialog, /── After Skill loaded, 10-16 21:00 ─+/);
  assert.match(dialog, /Name the tests in the testing skill description/);
  assert.ok(dialog.indexOf('After E2E') < dialog.indexOf('After Skill loaded'));
  assert.match(dialog, /Make the ones you agree with and commit: the next evals shows whether/);
});

test('the Evals tab without an evals run yet, and while one runs, also without Temporal', () => {
  const ui = { view: 'evals' as const, need: 0, column: 0, scroll: [], cursor: [], stage: 0, tick: 0 };
  assert.match(render({ ...implementing, temporal: false, evalReports: [] }, ui, 126, 40).plain(), /No evals yet\. It grades the setup on fixed tasks: press s to start one/);
  assert.match(render({ ...implementing, temporal: false, evalReports: HISTORY }, ui, 126, 40).plain(), /Latest E2E, 10-16 17:45/);
  const running = {
    workflowId: 'evals-20261016-180000',
    status: { evalsId: '20261016-180000', costUsd: 4.2, runs: [
      { task: 't', run: 1, state: 'done' as const, accepted: true }, { task: 't', run: 2, state: 'grading' as const }, { task: 't', run: 3, state: 'waiting' as const },
    ] },
    runs: [],
  };
  assert.match(render({ ...implementing, evalReports: [], evals: running }, ui, 126, 40).plain(), /evals-20261016-180000 ─[^]*1 of 3 runs done · 1 accepted · 1 working +\$4\.20 so far/);
});

test('s in the Evals tab starts an evals run: all tasks or one, with what it will cost and what isn’t graded', () => {
  const ui = { view: 'evals' as const, need: 0, column: 0, scroll: [], cursor: [], stage: 0, tick: 0 };
  const tasks = ['min-delay-filter', 'delays-csv'].map((id) => ({ id, request: '', base: 'b' }));
  assert.match(render({ ...implementing, evalReports: HISTORY }, ui, 126, 40).plain(), /s start evals/);

  const all = render({ ...implementing, evalReports: HISTORY }, { ...ui, dialog: { kind: 'startEvals', tasks, cursor: 0, uncommitted: [], evalReports: HISTORY } }, 126, 40).plain();
  assert.match(all, /▶ Start evals/);
  assert.match(all, /› {2}E2E, all 2 tasks/);
  assert.match(all, /6 runs\. Cost: about \$9\.00, by the last evals\./); // the last evals: $9 for 6 runs
  assert.doesNotMatch(all, /Not committed/);

  const one = render({ ...implementing, evalReports: [] }, { ...ui, dialog: { kind: 'startEvals', tasks, cursor: 2, uncommitted: ['.agents/skills/review/SKILL.md'], evalReports: [] } }, 126, 40).plain();
  assert.match(one, /› {2}delays-csv/);
  assert.match(one, /3 runs\. Cost: unknown, there was no evals yet\./);
  assert.match(one, /Not committed, so not graded: \.agents\/skills\/review\/SKILL\.md/);

  // While an evals run runs, E2E can't start another, but the Skill loaded tab can start the skill-loaded evals, and the other way round
  const running = { workflowId: 'evals-20261016-180000', status: { evalsId: '20261016-180000', runs: [] }, runs: [] };
  assert.doesNotMatch(render({ ...implementing, evalReports: HISTORY, evals: running }, ui, 126, 40).plain(), /s start evals/);
  assert.match(render({ ...implementing, evalReports: HISTORY, evals: running }, { ...ui, evalsKind: 'skillLoaded' }, 126, 40).plain(), /s start evals/);
  const skillLoadedEvals = { workflowId: 'skill-loaded-evals-20261016-180100' };
  assert.doesNotMatch(render({ ...implementing, evalReports: HISTORY, skillLoadedEvals }, { ...ui, evalsKind: 'skillLoaded' }, 126, 40).plain(), /s start evals/);
  assert.match(render({ ...implementing, evalReports: HISTORY, skillLoadedEvals }, ui, 126, 40).plain(), /s start evals/);
});

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

test('the Evals tab shows one kind at a time, E2E or Skill loaded', () => {
  assert.deepEqual(skillTrend(SKILL_HISTORY).map((c) => [c.label, c.passing]), [['10-15 12:00', 'first'], ['10-16 21:00', 'noise']]);
  const ui = { view: 'evals' as const, need: 0, column: 0, scroll: [], cursor: [], stage: 0, tick: 0 };
  const s = { ...implementing, evalReports: HISTORY, skillReports: SKILL_HISTORY };

  // E2E first: no skill column, row or grid
  const e2e = render(s, ui, 140, 40).plain();
  assert.match(e2e, /\[ E2E \] +Skill loaded/);
  assert.match(e2e, /Trend +10-14 09:00 +10-15 09:00 +10-16 17:45 \*\n/);
  assert.match(e2e, /Quality, runs accepted +2 \/ 6 +5 \/ 6 ↑ +5 \/ 6\n/);
  assert.match(e2e, /Latest E2E, 10-16 17:45/);
  assert.doesNotMatch(e2e, /Cases passing|Latest Skill loaded|10-16 21:00/);

  const text = render(s, { ...ui, evalsKind: 'skillLoaded' }, 140, 40).plain();
  assert.match(text, /E2E +\[ Skill loaded \]/);
  assert.match(text, /Trend +10-15 12:00 +10-16 21:00\n/);
  assert.match(text, /Cases passing +2 \/ 3 +2 \/ 3\n/);
  assert.doesNotMatch(text, /Quality|Latest E2E|dimmed: within noise/);
  assert.match(text, /Latest Skill loaded, 10-16 21:00/);
  assert.match(text, /testing +✓ +✓ +✗ +Add an endpoint that returns all flights of one airline\./);
  assert.match(text, /testing +✗ +✓ +✓ +not: Fix the typos in README\.md\./); // ✓: it didn't load, as expected
  assert.match(text, /api-design +✓ +✗ +✗ +Return 404 when the airport is unknown\./);

  // Only skill-loaded evals: that sub-view is the one shown at first
  const only = render({ ...implementing, skillReports: SKILL_HISTORY }, ui, 140, 40).plain();
  assert.match(only, /E2E +\[ Skill loaded \]/);
  assert.doesNotMatch(only, /Quality/);
  assert.match(only, /Cases passing/);

  // An evals run that runs shows in its own sub-view, and a spinner on the other one's name
  const skillRun = { workflowId: 'skill-loaded-evals-20261017-100000', status: { evalsId: '20261017-100000', done: 3, runs: 9, asExpected: 2, costUsd: 0.1, step: 'running' } } as unknown as Snapshot['skillLoadedEvals'];
  const running = { ...s, skillLoadedEvals: skillRun };
  assert.doesNotMatch(render(running, ui, 140, 40).plain(), /skill-loaded-evals-20261017-100000 runs/);
  assert.match(render(running, ui, 140, 40).plain(), /\[ E2E \] +Skill loaded ⠋/);
  assert.match(render(running, { ...ui, evalsKind: 'skillLoaded' }, 140, 40).plain(), /skill-loaded-evals-20261017-100000 ─[^]*3 of 9 runs done · 2 as expected/);
});

test('in the Evals tab, the arrows go through the runs of both grids, and ⏎ on a case’s run shows what it did', () => {
  const s = { ...implementing, evalReports: HISTORY, skillReports: SKILL_HISTORY };
  const ui = { view: 'evals' as const, need: 0, column: 0, scroll: [], cursor: [], stage: 0, tick: 0, evalsRun: 4, evalsKind: 'skillLoaded' as const }; // the 5th run of the skills, api-design's 2nd... clamped below
  ui.evalsRun = 3; // testing's 2nd case, run 1
  moveRun(s, ui, '\x1b[C');
  moveRun(s, ui, '\x1b[A'); // up into the first case, the same column
  const cell = selectedRun(s, ui)!;
  assert.equal(cell.kind, 'skill');
  assert.equal(cell.row, 0);
  assert.equal(cell.col, 1);
  assert.equal(cell.kind === 'skill' && cell.result.skill, 'testing');
  moveRun(s, ui, '\x1b[A'); // the first row stays
  assert.equal(selectedRun(s, ui)?.row, 0);
  ui.evalsRun = 100; // the view keeps the pick within the grid: the last run of the last case
  assert.equal(selectedRun(s, ui)?.row, 2);
  assert.equal(selectedRun({ ...s, skillReports: [] }, { ...ui, evalsKind: 'e2e', evalsRun: 100 })?.kind, 'e2e'); // each sub-view has its own runs

  const failing = SKILL_HISTORY[1].results[2];
  const dialog = render(s, { ...ui, dialog: { kind: 'skillLoadedEvalRun', result: failing, run: 2 } }, 126, 40).plain();
  assert.match(dialog, /✗ api-design, run 2/);
  assert.match(dialog, /Not as expected/);
  assert.match(dialog, /The skill should load\. In this run it didn't load\./);
  assert.match(dialog, /The case fails: 1 of 3 runs as expected · cost \$0\.02/);

  const failed = { ...failing, runs: [{ failure: 'claude exited with code 1' }, ...failing.runs.slice(1)] };
  const failedText = render(s, { ...ui, dialog: { kind: 'skillLoadedEvalRun', result: failed, run: 1 } }, 126, 40).plain();
  assert.match(failedText, /In this run it failed: claude exited with code 1\./);
  assert.match(failedText, /The case fails: 0 of 3 runs as expected\s*│/); // no cost: the failed run didn't report one
});

test('s in the Skill loaded tab starts only the skill-loaded evals, with what it will cost and the skill files it checks as they are', () => {
  const ui = { view: 'evals' as const, need: 0, column: 0, scroll: [], cursor: [], stage: 0, tick: 0 };
  const tasks = ['min-delay-filter', 'delays-csv'].map((id) => ({ id, request: '', base: 'b' }));
  const skills = { names: ['api-design', 'testing'], cases: 10 };
  assert.deepEqual(evalsChoices(tasks).map((c) => c.label), ['E2E, all 2 tasks', 'min-delay-filter', 'delays-csv']); // the E2E tab
  assert.deepEqual(evalsChoices([], skills).map((c) => c.label), ['Skill loaded, all 2 skills']); // the Skill loaded tab

  const uncommitted = ['.agents/skills/testing/SKILL.md', '.harness/src/cli/index.ts'];
  const dialog = { kind: 'startEvals' as const, tasks: [], cursor: 0, uncommitted, evalReports: HISTORY, skills, skillReports: SKILL_HISTORY };
  const text = render({ ...implementing, evalReports: HISTORY }, { ...ui, dialog }, 126, 40).plain();
  assert.match(text, /› {2}Skill loaded, all 2 skills/);
  assert.match(text, /Checks whether the agent loads the skills/);
  assert.match(text, /30 runs\. Cost: about \$0\.60, by the last skill-loaded evals\./); // the last one: $0.18 for 9 runs
  assert.match(text, /Not committed, but checked as they are: \.agents\/skills\/testing\/SKILL\.md/);
  assert.doesNotMatch(text, /cli\.ts/);
  assert.match(render(implementing, { ...ui, dialog: { ...dialog, skillReports: [] } }, 126, 40).plain(), /30 runs\. Cost: unknown, there was no skill-loaded evals yet\./);
});

test('a running skill-loaded evals shows how far it is', () => {
  const ui = { view: 'evals' as const, need: 0, column: 0, scroll: [], cursor: [], stage: 0, tick: 0 };
  const skillLoadedEvals = { workflowId: 'skill-loaded-evals-20261016-213000', status: { evalsId: '20261016-213000', step: 'running' as const, runs: 30, done: 12, asExpected: 11, costUsd: 0.24 } };
  const text = render({ ...implementing, skillLoadedEvals }, ui, 126, 40).plain();
  assert.match(text, /skill-loaded-evals-20261016-213000/);
  assert.match(text, /▰+▱+ +12 of 30 runs done · 11 as expected +\$0\.24 so far/);
  assert.match(text, /The trend shows up once an evals run is done\./);
  const proposing = render({ ...implementing, skillLoadedEvals: { ...skillLoadedEvals, status: { ...skillLoadedEvals.status, step: 'writing proposals' as const, done: 30 } } }, ui, 160, 40).plain();
  assert.match(proposing, /30 of 30 runs done/);
  assert.match(proposing, /⠋ writing proposals +the improve agent proposes changes for the failing cases/);
});

test('an evals run’s id is when it starts, in UTC, the same for flows evals and flows watch', () => {
  assert.equal(newEvalsId(new Date('2026-10-16T17:45:09.123Z')), '20261016-174509');
});

test('a running evals shows where each working run is: its phase, its loops’ steps, the judge, and what it cost', () => {
  const ui = { view: 'evals' as const, need: 0, column: 0, scroll: [], cursor: [], stage: 0, tick: 0 };
  const running = {
    workflowId: 'evals-20261016-181226',
    status: { evalsId: '20261016-181226', costUsd: 3, runs: [
      { task: 'status-filter', run: 1, state: 'done' as const, accepted: true, costUsd: 3 },
      { task: 'status-filter', run: 2, state: 'running' as const },
      { task: 'status-filter', run: 3, state: 'running' as const },
      { task: 'delays-csv', run: 1, state: 'grading' as const },
      { task: 'delays-csv', run: 2, state: 'waiting' as const },
    ] },
    runs: [
      { task: 'status-filter', run: 2, state: 'running' as const, pipeline: status('researching', { run: 2, judging: true, costUsd: 0.4 }), loops: [] },
      {
        task: 'status-filter', run: 3, state: 'running' as const, pipeline: status('implementing', { costUsd: 1 }),
        loops: [
          { ticket: 'TICKET-1', state: 'done' as const, costUsd: 0.5 },
          { ticket: 'TICKET-2', state: 'running' as const, run: 4, judging: true, costUsd: 0.25 },
        ],
      },
      { task: 'delays-csv', run: 1, state: 'grading' as const, pipeline: status('done', { costUsd: 2 }), loops: [] },
    ],
  };
  const text = render({ ...implementing, evalReports: [], evals: running }, ui, 126, 40).plain();
  // 3 for the finished run, 0.40 + 1.75 + 2 for the working ones
  assert.match(text, /evals-20261016-181226/);
  assert.match(text, /▰+▱+ +1 of 5 runs done · 1 accepted · 3 working +\$7\.15 so far/);
  assert.match(text, /status-filter +run 1 +✓ accepted +\$3\.00 *│$/m);
  assert.match(text, /status-filter +run 2 +⠋ research +run 2 · ⚖ judge is checking +\$0\.40 *│$/m);
  assert.match(text, /status-filter +run 3 +⠋ implement +TICKET-1 ✓, TICKET-2 step 4 · ⚖ judge is checking +\$1\.75 *│$/m);
  assert.match(text, /delays-csv +run 1 +⠋ grading +hidden tests, then the grader +\$2\.00 *│$/m);
  assert.match(text, /delays-csv +run 2 +· waiting +│$/m);
  assert.doesNotMatch(render({ ...implementing, evalReports: [], evals: running }, ui, 80, 24).plain(), /judge is checking|hidden tests/); // too narrow for the detail
  assert.match(text, /The trend shows up once an evals run is done\./);
  assert.doesNotMatch(text, /press s/);
});

test('the footer shows the agent new workflows start with, and a switches it', () => {
  const ui = { view: 'pipeline' as const, need: 0, column: 0, scroll: [], cursor: [], stage: 0, tick: 0, agent: 'copilot' as const };
  assert.match(render(implementing, ui, 140, 40).plain(), /a agent: copilot/);
  assert.doesNotMatch(render(implementing, { ...ui, agent: undefined }, 140, 40).plain(), /agent: /);
});

test('in the Evals tab, ↑ from the first row moves to the E2E / Skill loaded bar, where ←→ switch and ↓ goes back', () => {
  const s = { ...implementing, evalReports: HISTORY, skillReports: SKILL_HISTORY };
  const ui: Ui = { view: 'evals', need: 0, column: 0, scroll: [], cursor: [], stage: 0, tick: 0, evalsRun: 1 };
  const UP = '\x1b[A', DOWN = '\x1b[B', LEFT = '\x1b[D', RIGHT = '\x1b[C';
  assert.match(render(s, ui, 140, 40).plain(), /↑ E2E · Skill loaded/);

  moveRun(s, ui, UP);
  assert.equal(ui.evalsTabs, true);
  const onBar = render(s, ui, 140, 40).plain();
  assert.match(onBar, /←→ E2E · Skill loaded +· +↓ select run/);
  assert.doesNotMatch(onBar, /⏎ details/);

  moveRun(s, ui, LEFT); // E2E is the first one: stays
  assert.equal(evalsKindOf(s, ui), 'e2e');
  moveRun(s, ui, RIGHT);
  assert.equal(evalsKindOf(s, ui), 'skillLoaded');
  assert.equal(ui.evalsTabs, true);
  assert.match(render(s, ui, 140, 40).plain(), /Latest Skill loaded/);
  moveRun(s, ui, RIGHT); // and Skill loaded the last
  assert.equal(evalsKindOf(s, ui), 'skillLoaded');
  moveRun(s, ui, LEFT);
  assert.equal(evalsKindOf(s, ui), 'e2e');
  moveRun(s, ui, RIGHT);
  assert.equal(evalsKindOf(s, ui), 'skillLoaded');

  moveRun(s, ui, DOWN);
  assert.equal(ui.evalsTabs, false);
  assert.equal(selectedRun(s, ui)?.kind, 'skill');
  moveRun(s, ui, DOWN); // within the grid, ↑↓ move between rows as before
  assert.equal(selectedRun(s, ui)?.row, 1);
  assert.equal(ui.evalsTabs, false);

  // Without runs there is nothing to select, so ←→ switch right away
  const none: Ui = { ...ui, evalsTabs: false, evalsKind: 'e2e', evalsRun: undefined };
  moveRun({ ...implementing, evalReports: [], skillReports: SKILL_HISTORY }, none, RIGHT);
  assert.equal(none.evalsKind, 'skillLoaded');
});

test('long lists scroll instead of pushing the rest off the screen', () => {
  const ui: Ui = { view: 'evals', need: 0, column: 0, scroll: [], cursor: [], stage: 0, tick: 0 };
  const tasks = Array.from({ length: 30 }, (_, i) => `task-${i}`);
  const big: EvalsReport = { ...HISTORY[2], tasks, runs: tasks.flatMap((task) => [1, 2, 3].map((run) => ({ ...HISTORY[2].runs[3], task, run }))) };

  // A running evals of 90 runs leaves room for the trend and the latest evals, and shows the runs that work
  const running = {
    workflowId: 'evals-20261017-090000',
    status: { evalsId: '20261017-090000', costUsd: 0, runs: big.runs.map((r, i) => ({ task: r.task, run: r.run, state: i < 40 ? ('done' as const) : i < 43 ? ('running' as const) : ('waiting' as const), accepted: true })) },
    runs: [],
  };
  const text = render({ ...implementing, evalReports: [big], evals: running }, ui, 126, 40).plain();
  assert.match(text, /│ 40 done above +│\n *│ task-13 +run 2 +⠋ starting/);
  assert.match(text, /│ \+ \d+ more +│/);
  assert.match(text, /task-13 +run 2 +⠋ starting/);
  assert.match(text, /Quality, runs accepted/);
  assert.match(text, /Latest E2E/);

  // The latest evals' grid keeps the picked run in view
  const picked = { ...ui, evalsRun: 3 * 25 };
  const grid = render({ ...implementing, evalReports: [big] }, picked, 126, 30).plain();
  assert.match(grid, /task-25 /);
  assert.doesNotMatch(grid, /task-0 /);
  assert.match(grid, /↑ \d+ more · ↓ \d+ more/);
  assert.ok(grid.split('\n').length <= 30);

  // A long list in a dialog: a window around the picked item, with how many more there are
  const items = tasks.map((id) => ({ id, title: '' }));
  const dialog = { kind: 'pick' as const, target: 'ralph' as const, items, cursor: 20 };
  const picking = render(implementing, { ...ui, view: 'pipeline', dialog }, 126, 30).plain();
  assert.match(picking, /› +task-20/);
  assert.match(picking, /↑ \d+ more/);
  assert.match(picking, /↓ \d+ more/);
  assert.match(picking, /esc cancel/);

  // Many loops leave the worker output room
  const loops = tasks.map((id) => ({ workflowId: `ralph-${id}`, ticket: id, state: 'done' as const }));
  const pipeline = render({ ...implementing, loops }, { ...ui, view: 'pipeline' }, 126, 40).plain();
  assert.match(pipeline, /\+ \d+ more/);
  assert.match(pipeline, /Worker output/);
});

test('a dialog longer than the terminal scrolls', () => {
  const ui: Ui = { view: 'evals', need: 0, column: 0, scroll: [], cursor: [], stage: 0, tick: 0 };
  const run = { ...HISTORY[2].runs[2], reason: Array.from({ length: 40 }, (_, i) => `reason line ${i}.`).join('\n') };
  const dialog = { kind: 'evalsRun' as const, run, scroll: 999 };
  const text = render({ ...implementing, evalReports: HISTORY }, { ...ui, dialog }, 80, 20).plain();
  assert.match(text, /↑↓ scroll/);
  assert.match(text, /The grader:/); // scrolled to the end, never past it
  assert.ok(dialog.scroll < 999);
});

test('a running evals always shows every working run, also more than half the screen and done ones between them', () => {
  const ui: Ui = { view: 'evals', need: 0, column: 0, scroll: [], cursor: [], stage: 0, tick: 0 };
  // 90 runs: the first 30 done, then 15 working with every other one done already, then waiting
  const runs = Array.from({ length: 90 }, (_, i) => ({ task: `task-${Math.floor(i / 3)}`, run: (i % 3) + 1 }))
    .map((r, i) => (i < 30 || (i < 60 && i % 2) ? { ...r, state: 'done' as const, accepted: true } : i < 60 ? { ...r, state: 'running' as const } : { ...r, state: 'waiting' as const }));
  const running = { workflowId: 'evals-20261017-090000', status: { evalsId: '20261017-090000', costUsd: 0, runs }, runs: [] };
  const text = render({ ...implementing, evalReports: HISTORY, evals: running }, ui, 126, 40).plain();
  for (const r of runs.filter((r) => r.state === 'running')) assert.match(text, new RegExp(`${r.task} +run ${r.run} +⠋ starting`));
  assert.match(text, /│ 30 done above +│\n *│ task-10 +run 1 +⠋ starting/);
  assert.match(text, /│ \+ \d+ more +│/);
});

test('starting a loop offers one run or the whole loop, and throwing one away says what goes', () => {
  const s: Snapshot = { ...implementing, pipeline: undefined, loops: [{ workflowId: 'ralph-TICKET-1', ticket: 'TICKET-1', state: 'stopped' }] };
  const ui = { view: 'board' as const, need: 0, column: 0, scroll: [], cursor: [], stage: 0, tick: 0 };
  const ticket = implementing.backlog[0];
  for (const [width, height] of [[80, 24], [126, 40]]) {
    const start = render(s, { ...ui, dialog: { kind: 'start', ticket: ticket.id, title: ticket.title } }, width, height).plain();
    assert.ok(start.split('\n').every((line) => [...line].length <= width));
    assert.match(start, /1 one run/);
    assert.match(start, /y loop/);
    assert.match(start, /at most 30 runs/);
    const opened = render(s, { ...ui, dialog: { kind: 'ticket', ticket, content: ticketFile, scroll: 0, start: true, merge: false, discard: true } }, width, height).plain();
    assert.match(opened, /x throw away/);
    const discard = render(s, { ...ui, dialog: { kind: 'discard', ticket: ticket.id, title: ticket.title, running: false, commits: 2 } }, width, height).plain();
    assert.ok(discard.split('\n').every((line) => [...line].length <= width));
    assert.match(discard, /Throw away TICKET-1/);
    assert.match(discard, /Removes its worktree \.harness\/worktrees\/ticket-1/);
    assert.match(discard, /2 commits that aren't anywhere else/);
    assert.match(discard, /y throw away/);
  }
  const running = render(s, { ...ui, dialog: { kind: 'discard', ticket: ticket.id, title: ticket.title, running: true, commits: 0 } }, 126, 40).plain();
  assert.match(running, /Stops its loop, removes its worktree/);
  assert.doesNotMatch(running, /commits that/);
});

test('the Evals tab only shows once the branch has .harness/evals/', () => {
  const ui = { view: 'pipeline' as const, need: 0, column: 0, scroll: [], cursor: [], stage: 0, tick: 0 };
  const before = { ...implementing, withoutEvals: true };
  const header = (s: Snapshot) => render(s, ui, 126, 40).plain().split('\n')[0];
  assert.match(header(implementing), /Pipeline +Board +Evals/);
  assert.match(header(before), /Pipeline +Board/);
  assert.doesNotMatch(header(before), /Evals/);
  assert.equal(nextView(before, 'board'), 'pipeline');
  assert.equal(nextView(implementing, 'board'), 'evals');
  assert.match(render(before, { ...ui, view: 'board' }, 126, 40).plain(), /tab pipeline/);
});
