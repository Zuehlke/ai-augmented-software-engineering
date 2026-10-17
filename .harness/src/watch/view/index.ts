// Draws `flows watch`: the pipeline as in the Lab 12 diagram, the backlog as a board, or the evals run's trend, plus
// the dialogs. Each tab is in a file of its own: pipeline.ts, board.ts and evals.ts, the dialogs in dialog.ts.
import { BOLD, DIM, Grid, LINE, YOU } from '../grid';
import type { Snapshot } from '../model';
import { describe, needs } from '../model';
import type { Agent } from '../../shared';
import { boardView, selectedCard } from './board';
import { actionOf } from './common';
import type { Dialog } from './dialog';
import { dialog } from './dialog';
import type { EvalsKind } from './evals';
import { evalsKindOf, evalsView, latestProposals, selectedRun } from './evals';
import { pipelineView } from './pipeline';

export const VIEWS = ['pipeline', 'board', 'evals'] as const;

// The tabs that show: Evals only once the branch has .harness/evals/, from Lab 13 on
export function views(s: Snapshot): readonly View[] {
  return s.withoutEvals ? VIEWS.filter((view) => view !== 'evals') : VIEWS;
}

// The tab after the one you're on. A tab that doesn't show anymore, after you switched branches, goes to the first.
export function nextView(s: Snapshot, view: View): View {
  const shown = views(s);
  return shown[(shown.indexOf(view) + 1) % shown.length];
}

type View = (typeof VIEWS)[number];

export interface Ui {
  view: View;
  need: number; // which of the needs the banner shows
  column: number; // the board column of the selected ticket
  scroll: number[]; // per board column, how many cards are scrolled out of view
  cursor: number[]; // per board column, the selected card
  stage: number; // the phase card of the pipeline that ⏎ starts
  evalsKind?: EvalsKind; // the Evals tab's sub-view, by default the e2e evals, or the skill-loaded evals when only those ran
  evalsTabs?: boolean; // the E2E / Skill loaded bar has the focus, so ←→ switch between them
  evalsRun?: number; // the run picked in the Evals tab's grid, counted over all its rows
  evalsScroll?: number; // the first row of the latest evals' grid that shows, when it's longer than the screen
  dialog?: Dialog;
  // The worker output you scrolled back in: held still while you read, unset while it follows the new lines
  log?: { lines: string[]; scroll: number };
  message?: string;
  tick: number;
  branch?: string;
  agent?: Agent; // the agent new workflows start with, switched with a
}

export function render(s: Snapshot, ui: Ui, width: number, height: number): Grid {
  const g = new Grid(width, height);
  const all = needs(s);
  header(g, s, ui);
  let y = 2;
  if (!s.temporal) {
    banner(g, y, 'Temporal isn\'t running. Start it and the worker: task flows:start', '');
  } else if (!s.worker) {
    banner(g, y, 'The worker isn\'t running, so nothing moves. Start it: task flows:start. Its output: flows logs', '');
  } else if (all.length) {
    const need = all[Math.min(ui.need, all.length - 1)];
    const count = all.length > 1 ? ` (${Math.min(ui.need, all.length - 1) + 1} of ${all.length})` : '';
    banner(g, y, describe(need) + count, `n ${actionOf(need)}`);
  } else {
    g.text(4, y, 'Nothing waits for you.', DIM);
  }
  y += 2;

  if (ui.view === 'board') boardView(g, s, ui, y);
  else if (ui.view === 'evals') evalsView(g, s, ui, y);
  else pipelineView(g, s, ui, y);

  // The keys in the footer: what works in this view right now
  const keys: [string, string][] = [];
  if (ui.view === 'board' && selectedCard(s, ui)) keys.push(['⏎', 'open ticket']);
  if (ui.view === 'pipeline') {
    keys.push(['←→', 'phase'], ['⏎', PHASE_ACTIONS[ui.stage]], ['↑↓', 'scroll output']);
    if (ui.log) keys.push(['End', 'follow']);
  }
  if (all.length && s.temporal) keys.push(['n', actionOf(all[Math.min(ui.need, all.length - 1)])]);
  if (ui.view === 'board') {
    keys.push(['←→↑↓', 'select ticket']);
    if (selectedCard(s, ui)?.column === 'Ready') keys.push(['s', 'start']);
  }
  if (ui.view === 'evals') {
    const picked = selectedRun(s, ui);
    if (!picked || ui.evalsTabs) {
      keys.push(['←→', 'E2E · Skill loaded']);
      if (picked) keys.push(['↓', 'select run']);
    } else {
      keys.push(['←→↑↓', 'select run'], ['⏎', 'details']);
      if (picked.row === 0) keys.push(['↑', 'E2E · Skill loaded']);
    }
  }
  if (ui.view === 'evals' && !(evalsKindOf(s, ui) === 'skillLoaded' ? s.skillLoadedEvals : s.evals)) keys.push(['s', 'start evals']);
  if (ui.view === 'evals' && latestProposals(s).length) keys.push(['p', 'proposals']);
  if (ui.agent) keys.push(['a', `agent: ${ui.agent}`]);
  keys.push(['tab', nextView(s, ui.view)], ['q', 'quit']);
  footer(g, keys, ui.message);
  if (ui.dialog) dialog(g, ui.dialog, new Map(s.backlog.map((t) => [t.id, t.title])), ui.view === 'pipeline' ? 11 : 4);
  return g;
}

// What ⏎ does on each phase card of the pipeline
export const PHASE_ACTIONS = ['create feature request', 'plan tickets', 'implement ticket', 'review and merge'];

function header(g: Grid, s: Snapshot, ui: Ui): void {
  let x = 2;
  const labels = { pipeline: 'Pipeline', board: 'Board', evals: 'Evals' };
  for (const view of views(s)) {
    const label = labels[view];
    const active = ui.view === view;
    g.text(x, 0, label, active ? BOLD : DIM);
    if (active) g.text(x, 1, '─'.repeat(label.length), BOLD);
    x += label.length + 3;
  }
  const parts: [string, boolean][] = [[`Temporal`, s.temporal], [`Worker`, s.worker]];
  let rx = g.width - 2 - (ui.branch?.length ?? 0);
  if (ui.branch) g.text(rx, 0, ui.branch, DIM);
  for (const [name, ok] of parts.reverse()) {
    rx -= name.length + 5;
    g.text(rx, 0, ok ? '●' : '○', ok ? DIM : YOU);
    g.text(rx + 2, 0, name, DIM);
  }
  for (let i = 0; i < g.width; i++) if (g.cells[1][i].ch === ' ') g.put(i, 1, '─', LINE);
}

// The one line that always says what waits for a person
function banner(g: Grid, y: number, text: string, key: string): void {
  g.fill(2, y, g.width - 4, 1, { bg: 'you' });
  g.put(2, y, '▌', { fg: 'you' });
  const x = g.text(4, y, 'Needs you', YOU);
  g.text(x + 3, y, text, { fg: 'text' }, g.width - x - key.length - 10);
  if (key) g.text(g.width - key.length - 4, y, key, YOU);
}

function footer(g: Grid, keys: [string, string][], message?: string): void {
  const y = g.height - 1;
  let x = 2;
  keys.forEach(([key, label], i) => {
    if (i) x = g.text(x + 2, y, '·', LINE) + 2;
    x = g.text(x, y, key, BOLD);
    x = g.text(x + 1, y, label, DIM);
  });
  if (message) g.text(Math.max(x + 3, g.width - message.length - 2), y, message, DIM);
}
