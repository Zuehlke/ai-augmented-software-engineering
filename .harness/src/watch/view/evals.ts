// The Evals tab: the trend of the evals runs, the latest one as a grid of its runs, and what you can pick in it
import { BOLD, DIM, Grid, RUN, Style, YOU } from '../grid';
import type { Change, Snapshot } from '../model';
import { evalsGrid, passingCases, skillTrend, trend } from '../model';
import { dollars } from '../../shared';
import type { EvalsRun, EvalsTask } from '../../types/evals';
import type { SkillLoadedEvalResult } from '../../types/skill-loaded-evals';
import { asExpected } from '../../types/skill-loaded-evals';
import { scrollWindow, spin } from './common';
import type { SkillChoice } from './dialog';
import { e2eRunning, skillsRunning } from './evals-running';
import type { Ui } from './index';

// The Evals tab shows one kind of evals at a time
export type EvalsKind = 'e2e' | 'skillLoaded';
export const EVALS_KINDS: [EvalsKind, string][] = [['e2e', 'E2E'], ['skillLoaded', 'Skill loaded']];

export function evalsKindOf(s: Snapshot, ui: Ui): EvalsKind {
  if (ui.evalsKind) return ui.evalsKind;
  const onlySkills = !s.evalReports.length && !s.evals && (s.skillReports.length > 0 || !!s.skillLoadedEvals);
  return onlySkills ? 'skillLoaded' : 'e2e';
}

// What the start dialog of the Evals tab offers: all tasks, then each one on its own, then the skill-loaded evals
export interface EvalsChoice {
  label: string;
  tasks: EvalsTask[];
  skills?: boolean; // the skill-loaded evals instead of tasks
}

export function evalsChoices(tasks: EvalsTask[], skills?: SkillChoice): EvalsChoice[] {
  const choices: EvalsChoice[] = tasks.length ? [{ label: `E2E, all ${tasks.length} tasks`, tasks }, ...tasks.map((task) => ({ label: task.id, tasks: [task] }))] : [];
  if (skills?.cases) choices.push({ label: `Skill loaded, all ${skills.names.length} skills`, tasks: [], skills: true });
  return choices;
}

// A cell of the Evals tab's grid: a run of the latest e2e evals, or a run of a case of the latest skill-loaded evals.
export type EvalsCell =
  | { kind: 'e2e'; row: number; col: number; run: EvalsRun }
  | { kind: 'skill'; row: number; col: number; result: SkillLoadedEvalResult };

export function evalsCells(s: Snapshot, kind: EvalsKind): EvalsCell[] {
  const cells: EvalsCell[] = [];
  if (kind === 'e2e') {
    evalsGrid(s.evalReports.at(-1)).forEach(({ runs }, row) => runs.forEach((run, col) => cells.push({ kind: 'e2e', row, col, run })));
    return cells;
  }
  const latest = s.skillReports.at(-1);
  (latest?.results ?? []).forEach((result, row) => result.runs.forEach((_, col) => cells.push({ kind: 'skill', row, col, result })));
  return cells;
}

export type Proposals = { title: string; text: string };

// What the improve agent proposed after the latest e2e evals and after the latest skill-loaded evals, each with that evals'
// label: both in one dialog, whichever sub-view you're in
export function latestProposals(s: Snapshot): Proposals[] {
  const sections: Proposals[] = [];
  const e2e = s.evalReports.at(-1);
  if (e2e?.proposals) sections.push({ title: `E2E, ${trend([e2e])[0].label}`, text: e2e.proposals });
  const skills = s.skillReports.at(-1);
  if (skills?.proposals) sections.push({ title: `Skill loaded, ${skillTrend([skills])[0].label}`, text: skills.proposals });
  return sections;
}

// The run picked in the Evals tab's grid
export function selectedRun(s: Snapshot, ui: Ui): EvalsCell | undefined {
  const cells = evalsCells(s, evalsKindOf(s, ui));
  if (!cells.length) return undefined;
  ui.evalsRun = Math.min(Math.max(ui.evalsRun ?? 0, 0), cells.length - 1);
  return cells[ui.evalsRun];
}

// In the grid: ←→ the runs in order, ↑↓ the run below or above, in the same column or the last one of a shorter row.
// ↑ from the first row, or any arrow without runs, moves to the E2E / Skill loaded bar, where ←→ switch and ↓ goes back.
export function moveRun(s: Snapshot, ui: Ui, key: string): void {
  const left = key === '\x1b[D';
  const right = key === '\x1b[C';
  const at = selectedRun(s, ui);
  if (!at || ui.evalsTabs) {
    if (left || right) {
      ui.evalsKind = right ? 'skillLoaded' : 'e2e';
      ui.evalsRun = undefined;
    }
    if ((key === '\x1b[B' || key === '\r') && at) ui.evalsTabs = false;
    return;
  }
  const cells = evalsCells(s, evalsKindOf(s, ui));
  const i = ui.evalsRun!;
  if (key === '\x1b[A' && at.row === 0) ui.evalsTabs = true;
  if (right) ui.evalsRun = Math.min(i + 1, cells.length - 1);
  if (left) ui.evalsRun = Math.max(i - 1, 0);
  const row = key === '\x1b[B' ? at.row + 1 : key === '\x1b[A' ? at.row - 1 : undefined;
  const inRow = cells.map((cell, index) => ({ cell, index })).filter(({ cell }) => cell.row === row);
  if (inRow.length) ui.evalsRun = inRow[Math.min(at.col, inRow.length - 1)].index;
}

// A number of the trend: a real change stands out, one within noise is dimmed
function changeStyle(change: Change): Style {
  return change === 'noise' ? DIM : BOLD;
}

const ARROWS: Record<Change, string> = { first: '', noise: '', better: ' ↑', worse: ' ↓' };

export function evalsView(g: Grid, s: Snapshot, ui: Ui, top: number): void {
  const kind = evalsKindOf(s, ui);
  kindBar(g, s, ui, kind, top);
  let y = top + 2;

  if (kind === 'e2e' && s.evals) y = e2eRunning(g, s.evals, ui, y);
  if (kind === 'skillLoaded' && s.skillLoadedEvals) y = skillsRunning(g, s.skillLoadedEvals, ui, y);

  const below = trendTable(g, s, kind, y);
  if (below === undefined) return; // no evals done yet
  y = below;

  const picked = ui.evalsTabs ? undefined : selectedRun(s, ui);
  const cell = (cx: number, cy: number, ok: boolean, on: boolean) => {
    if (on) g.fill(cx - 1, cy, 3, 1, { bg: 'selected' });
    g.text(cx, cy, ok ? '✓' : '✗', on ? BOLD : ok ? DIM : YOU);
  };

  // A grid longer than the room left: the rows from where it scrolled to, the picked one in view, how many more below
  const shownRows = (count: number): number[] => {
    const room = Math.max(1, g.height - 2 - y);
    const indices = Array.from({ length: count }, (_, i) => i);
    if (count <= room) return indices;
    const rows = Math.max(1, room - 1);
    const first = scrollWindow(count, rows, picked?.row ?? ui.evalsScroll ?? 0, ui.evalsScroll);
    ui.evalsScroll = first;
    const after = count - first - rows;
    g.text(4, y + rows, [first && `↑ ${first} more`, after && `↓ ${after} more`].filter(Boolean).join(' · '), DIM, g.width - 8);
    return indices.slice(first, first + rows);
  };

  // The latest e2e evals: one row per task, ✓ or ✗ per run
  const latest = s.evalReports.at(-1);
  if (kind === 'e2e' && latest) {
    const grid = evalsGrid(latest);
    y += 1;
    g.text(2, y, `Latest E2E, ${trend([latest])[0].label}`, BOLD);
    y += 1;
    const taskWidth = Math.min(28, Math.max(...grid.map((row) => row.task.length)) + 2);
    shownRows(grid.length).forEach((r) => {
      const row = grid[r];
      g.text(4, y, row.task, DIM, taskWidth);
      row.runs.forEach((run, i) => cell(4 + taskWidth + i * 4, y, run.accepted, picked?.kind === 'e2e' && picked.run === run));
      const failed = row.runs.find((run) => !run.accepted);
      const note = row.runs.every((run) => run.accepted) ? 'reliable' : (failed?.reason.split('\n')[0] ?? '');
      const nx = 4 + taskWidth + row.runs.length * 4 + 2;
      g.text(nx, y, note, DIM, g.width - nx - 2);
      y++;
    });
  }

  // The latest skill-loaded evals: one row per case, ✓ or ✗ per run, whether it did what the case expects
  const skills = s.skillReports.at(-1);
  if (kind === 'skillLoaded' && skills) {
    y += 1;
    g.text(2, y, `Latest Skill loaded, ${skillTrend([skills])[0].label}`, BOLD);
    y += 1;
    const skillWidth = Math.min(28, Math.max(0, ...skills.results.map((result) => result.skill.length)) + 2);
    shownRows(skills.results.length).forEach((r) => {
      const result = skills.results[r];
      g.text(4, y, result.skill, DIM, skillWidth);
      result.runs.forEach((run, i) => cell(4 + skillWidth + i * 4, y, asExpected(run, result.loads), picked?.kind === 'skill' && picked.result === result && picked.col === i));
      const nx = 4 + skillWidth + result.runs.length * 4 + 2;
      g.text(nx, y, `${result.loads ? '' : 'not: '}${result.prompt}`, DIM, g.width - nx - 2);
      y++;
    });
  }
}

// The sub-views: blue with a spinner while its evals runs, as a running phase is, and highlighted while the bar has the focus
function kindBar(g: Grid, s: Snapshot, ui: Ui, kind: EvalsKind, y: number): void {
  let x = 2;
  for (const [k, label] of EVALS_KINDS) {
    const active = k === kind;
    const running = k === 'e2e' ? s.evals : s.skillLoadedEvals;
    const name = running ? `${label} ${spin(ui)}` : label;
    const focused = active && (ui.evalsTabs || !selectedRun(s, ui));
    const style: Style = { ...(running ? RUN : active ? BOLD : DIM), ...(focused ? { bg: 'selected' as const } : {}) };
    x = g.text(x, y, active ? `[ ${name} ]` : `  ${name}  `, style) + 2;
  }
}

// The trend: one column per evals, the newest on the right, as many as fit, one row per number. Returns the line
// below it, or undefined when there's no evals yet: then it says how to start one.
function trendTable(g: Grid, s: Snapshot, kind: EvalsKind, y: number): number | undefined {
  const columns: { label: string; commit: string; models?: boolean }[] =
    kind === 'e2e' ? trend(s.evalReports).map((c) => ({ label: c.label, commit: c.commit, models: c.modelsChanged })) : skillTrend(s.skillReports);
  if (!columns.length) {
    const running = kind === 'e2e' ? s.evals : s.skillLoadedEvals;
    const hint = running
      ? 'The trend shows up once an evals run is done.'
      : kind === 'e2e'
        ? 'No evals yet. It grades the setup on fixed tasks: press s to start one.'
        : 'No skill-loaded evals yet. It checks whether the agent loads each skill when it should: press s to start one.';
    g.text(2, y, hint, DIM, g.width - 4);
    return undefined;
  }
  const labelWidth = 26;
  const colWidth = 15;
  const fit = Math.max(1, Math.floor((g.width - 4 - labelWidth) / colWidth));
  const skip = Math.max(0, columns.length - fit);
  g.text(2, y, 'Trend', BOLD);
  columns.slice(skip).forEach((c, i) => {
    const cx = 2 + labelWidth + i * colWidth;
    g.text(cx, y, c.label + (c.models ? ' *' : ''), c.models ? YOU : DIM, colWidth - 1);
    g.text(cx, y + 1, c.commit, DIM, colWidth - 1);
  });
  type Row = [string, (i: number) => [string, Style]];
  const rows: Row[] = [];
  if (kind === 'e2e') {
    const cols = trend(s.evalReports);
    rows.push(
      ['Quality, runs accepted', (i) => {
        const { report, quality } = cols[i];
        return [`${report.quality.accepted} / ${report.quality.of}${ARROWS[quality]}`, changeStyle(quality)];
      }],
      ['Reliability, tasks', (i) => {
        const { report, reliability } = cols[i];
        return [`${report.reliability.tasks} / ${report.reliability.of}${ARROWS[reliability]}`, changeStyle(reliability)];
      }],
      ['First time right', (i) => {
        const { firstTimeRight } = cols[i].report;
        return [firstTimeRight ? `${firstTimeRight.runs} / ${firstTimeRight.of}` : '–', BOLD];
      }],
      ['Cost per accepted', (i) => {
        const { costPerAccepted } = cols[i].report;
        return [costPerAccepted === undefined ? '–' : dollars(costPerAccepted), BOLD];
      }],
    );
  } else {
    const cols = skillTrend(s.skillReports);
    rows.push(['Cases passing', (i) => {
      const { report, passing } = cols[i];
      return [`${passingCases(report)} / ${report.results.length}${ARROWS[passing]}`, changeStyle(passing)];
    }]);
  }
  rows.forEach(([label, value], r) => {
    g.text(4, y + 3 + r, label, DIM, labelWidth - 3);
    columns.slice(skip).forEach((_, i) => {
      const [text, style] = value(skip + i);
      g.text(2 + labelWidth + i * colWidth, y + 3 + r, text, style, colWidth - 1);
    });
  });
  return y + 3 + rows.length;
}
