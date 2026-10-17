// A running evals in the Evals tab: how far it is, and what its runs are doing
import { BOLD, DIM, Grid, LINE, RUN, YOU } from '../grid';
import type { Snapshot } from '../model';
import { evalsCost, progressCost, progressOf } from '../model';
import { dollars } from '../../shared';
import { spin } from './common';
import type { Ui } from './index';

// A running evals in a frame like the Ralph loops': how far it is, and one row per working run
// At most half of what is left, so the trend and the latest evals below still show, but at least `least` rows if they fit
function runningBox(g: Grid, top: number, title: string, rows: number, draw: (y: number, inner: number) => void, least = 0): number {
  const room = g.height - 4 - top;
  const height = Math.min(rows + 2, Math.max(3, Math.ceil(room / 2), Math.min(least + 2, room)));
  g.box(2, top, g.width - 4, height, LINE);
  g.text(4, top, ` ${title} `, DIM, g.width - 8);
  draw(top + 1, height - 2);
  return top + height + 1;
}

// ▰▰▰▱▱▱: the runs done of all
function bar(g: Grid, x: number, y: number, done: number, total: number): number {
  const width = 16;
  const filled = total ? Math.round((done / total) * width) : 0;
  g.text(x, y, '▰'.repeat(filled), RUN);
  g.text(x + filled, y, '▱'.repeat(width - filled), LINE);
  return x + width + 2;
}

// Every run of it, in the order it runs them: where a working one is, and how a finished one did
export function e2eRunning(g: Grid, evals: NonNullable<Snapshot['evals']>, ui: Ui, top: number): number {
  const runs = evals.status?.runs ?? evals.runs;
  const done = runs.filter((r) => r.state === 'done');
  const working = runs.filter((r) => r.state === 'running' || r.state === 'grading').length;
  const accepted = done.filter((r) => 'accepted' in r && r.accepted).length;
  const isWorking = (r: (typeof runs)[number]) => r.state === 'running' || r.state === 'grading';
  // The box grows so the working runs fit, with the progress line and the lines for the ones that don't
  return runningBox(g, top, evals.workflowId, 2 + runs.length, (y, inner) => {
    const cost = `${dollars(evalsCost(evals))} so far`;
    const x = bar(g, 4, y, done.length, runs.length);
    if (evals.status?.proposing) g.text(x, y, `${spin(ui)} the improve agent writes proposals`, RUN, g.width - x - cost.length - 6);
    else g.text(x, y, `${done.length} of ${runs.length} runs done · ${accepted} accepted · ${working} working`, DIM, g.width - x - cost.length - 6);
    g.text(g.width - 4 - cost.length, y, cost, DIM);
    const wide = g.width >= 100;
    const taskWidth = Math.min(28, Math.max(0, ...runs.map((r) => r.task.length)) + 2);
    // Every working run shows, then the ones after the first that isn't done, in order. A line above for the
    // done ones before them, a line below for the rest.
    const room = Math.max(0, inner - 2);
    const active = runs.findIndex((r) => r.state !== 'done');
    const pick = (rows: number): number[] => {
      const keep = new Set(runs.flatMap((r, i) => (isWorking(r) ? [i] : [])).slice(0, rows));
      const start = active < 0 ? runs.length : active;
      for (let i = start; i < runs.length && keep.size < rows; i++) keep.add(i);
      for (let i = start - 1; i >= 0 && keep.size < rows; i--) keep.add(i); // near the end, the done ones before fill up
      return [...keep].sort((a, b) => a - b);
    };
    let shown = runs.map((_, i) => i);
    if (runs.length > room) {
      shown = pick(Math.max(0, room - 1)); // one line is enough when nothing is above, or nothing below
      if (shown[0] > 0 && shown.at(-1)! < runs.length - 1) shown = pick(Math.max(0, room - 2));
    }
    const first = shown[0] ?? 0;
    const after = runs.length - first - shown.length;
    const top = first ? 1 : 0;
    if (first) g.text(4, y + 2, `${first} done above`, DIM, g.width - 8);
    shown.map((i) => runs[i]).forEach((r, i) => {
      const ry = y + 2 + top + i;
      const p = evals.runs.find((w) => w.task === r.task && w.run === r.run);
      // A working run's cost so far, or a finished run's, once the evals keeps it
      let cost = '';
      if (p) cost = dollars(progressCost(p));
      else if ('costUsd' in r && r.costUsd !== undefined) cost = dollars(r.costUsd);
      g.text(4, ry, r.task, BOLD, taskWidth);
      g.text(4 + taskWidth, ry, `run ${r.run}`, DIM);
      let x = 4 + taskWidth + 8;
      const end = g.width - 4 - cost.length - 2;
      if (r.state === 'waiting' || r.state === 'done' || !p) {
        let label = 'accepted' in r && r.accepted ? '✓ accepted' : '× rejected';
        if (r.state === 'waiting') label = '· waiting';
        else if (r.state !== 'done') label = `${spin(ui)} starting`;
        g.text(x, ry, label, r.state === 'running' || r.state === 'grading' ? RUN : DIM, 13);
      } else {
        const { phase, detail, judging, you } = progressOf(p);
        g.text(x, ry, you ? '⚑ needs you' : `${spin(ui)} ${phase}`, you ? YOU : RUN, 13);
        x += 15;
        if (wide && detail) x = g.text(x, ry, detail, DIM, Math.max(0, end - x));
        if (wide && judging && end - x > 22) {
          if (detail) x = g.text(x, ry, ' · ', DIM);
          g.text(x, ry, '⚖ judge is checking', RUN, end - x);
        }
      }
      g.text(g.width - 4 - cost.length, ry, cost, DIM);
    });
    if (after && inner >= 3) g.text(4, y + 2 + top + shown.length, `+ ${after} more`, DIM, g.width - 8);
  }, 2 + runs.filter(isWorking).length + 2);
}

export function skillsRunning(g: Grid, skillLoadedEvals: NonNullable<Snapshot['skillLoadedEvals']>, ui: Ui, top: number): number {
  const st = skillLoadedEvals.status;
  const writing = st?.step === 'writing proposals';
  return runningBox(g, top, skillLoadedEvals.workflowId, writing ? 3 : 1, (y) => {
    const cost = `${dollars(st?.costUsd)} so far`;
    const x = bar(g, 4, y, st?.done ?? 0, st?.runs ?? 0);
    const text = st ? `${st.done} of ${st.runs} runs done · ${st.asExpected} as expected` : 'starting';
    g.text(x, y, text, DIM, g.width - x - cost.length - 6);
    if (st) g.text(g.width - 4 - cost.length, y, cost, DIM);
    if (writing) {
      const label = `${spin(ui)} writing proposals`;
      const lx = g.text(4, y + 2, label, RUN);
      g.text(lx + 2, y + 2, 'the improve agent proposes changes for the failing cases', DIM, g.width - lx - 8);
    }
  });
}
