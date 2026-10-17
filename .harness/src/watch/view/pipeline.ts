// The Pipeline tab: the phases as cards, the Ralph loops and other workflows below them, and the worker's output
import { BOLD, DIM, Grid, LINE, RUN, splitToWidth, Style, YOU } from '../grid';
import type { Loop, Snapshot, Stage } from '../model';
import { byUrgency, judging, pipelineCost, STAGES, stages } from '../model';
import { dollars } from '../../shared';
import { spin } from './common';
import type { Ui } from './index';

function stageStyle(stage: Stage): { border: Style; title: Style; heavy: boolean } {
  if (stage.state === 'running') return { border: RUN, title: RUN, heavy: true };
  if (stage.state === 'you' || stage.state === 'failed') return { border: YOU, title: YOU, heavy: true };
  return { border: LINE, title: stage.state === 'todo' ? DIM : BOLD, heavy: false };
}

export function pipelineView(g: Grid, s: Snapshot, ui: Ui, top: number): void {
  const titles = new Map(s.backlog.map((t) => [t.id, t.title]));
  const cards = phaseCards(g, s, ui, top);
  const anchor = cards.anchor; // the middle of the Implementation card, where the loops hang off
  let y = cards.y;

  // Many loops or workflows: the most urgent ones, as many as leave the worker output a third of the screen, and how many more
  const fit = (count: number) => {
    const rows = Math.max(3, Math.floor(g.height * 2 / 3) - y - 2);
    return count <= rows ? count : rows - 1;
  };
  const more = (count: number, shown: number, y: number) => {
    if (count > shown) g.text(5, y, `+ ${count - shown} more`, DIM, g.width - 10);
  };
  const loops = byUrgency(s.loops);
  if (loops.length) {
    const title = s.pipeline ? ' Implementation · one Ralph loop per ticket ' : ' Ralph loops ';
    if (anchor !== undefined && s.pipeline && ['implementing', 'reviewing'].includes(s.pipeline.status?.step ?? '')) {
      g.put(anchor, y - 1, '│', RUN);
    }
    const shown = fit(loops.length);
    const rows = shown + (loops.length > shown ? 1 : 0);
    g.box(2, y, g.width - 4, rows + 2, LINE);
    g.text(4, y, title, DIM);
    loops.slice(0, shown).forEach((loop, i) => loopRow(g, loop, titles.get(loop.ticket) ?? '', y + 1 + i, ui));
    more(loops.length, shown, y + 1 + shown);
    y += rows + 3;
  }

  if (s.others.length) {
    const shown = fit(s.others.length);
    const rows = shown + (s.others.length > shown ? 1 : 0);
    g.box(2, y, g.width - 4, rows + 2, LINE);
    g.text(4, y, ' Other workflows ', DIM);
    // The ones that need you first
    [...s.others].sort((a, b) => Number(b.state === 'you') - Number(a.state === 'you')).slice(0, shown).forEach((o, i) => {
      g.text(5, y + 1 + i, o.workflowId, BOLD, 24);
      g.text(31, y + 1 + i, o.state === 'you' ? '⚑ needs you' : `${spin(ui)} running`, o.state === 'you' ? YOU : RUN);
    });
    more(s.others.length, shown, y + 1 + shown);
    y += rows + 3;
  }

  workerOutput(g, s, ui, y);
}

// The phases, as cards, or in one line when they don't fit. Returns the line below them, and the anchor.
// Without a pipeline the steps still show, all waiting, also above loops started with `flows ralph`.
function phaseCards(g: Grid, s: Snapshot, ui: Ui, top: number): { y: number; anchor?: number } {
  let y = top;
  let anchor: number | undefined;
  const st = s.pipeline
    ? stages(s.pipeline, s.loops)
    : STAGES.map((_, i): Stage => ({ state: 'todo', status: ['waits for a request', 'waits for the spec', 'waits for approval', 'waits for the loops'][i] }));
  const gap = 5;
  const w = Math.floor((g.width - 4 - 3 * gap) / 4);
  if (w >= 20) {
    STAGES.forEach((stage, i) => {
      const x = 2 + i * (w + gap);
      const { border, title, heavy } = stageStyle(st[i]);
      // The selected phase gets the white frame, like the selected ticket on the board
      g.box(x, y, w, 6, i === ui.stage ? { fg: 'text' } : border, heavy);
      if (stage.gate) {
        const label = st[i].state === 'you' ? ' ⚑ your turn ' : ' ⚑ ';
        g.text(x + w - 2 - label.length, y, label, st[i].state === 'you' ? YOU : DIM);
      }
      // The phase's prompt file, on a tinted background like inline code
      // The implement loops are many, one per ticket: "many" in front, the file set off like inline code
      const lead = stage.parallel ? 'many ' : '';
      g.text(x + 2, y + 1, lead, DIM);
      g.fill(x + 2 + lead.length, y + 1, Math.min(stage.prompt.length, w - 4 - lead.length), 1, { bg: 'raised' });
      g.text(x + 2 + lead.length, y + 1, stage.prompt, { fg: 'muted' }, w - 4 - lead.length);
      g.text(x + 2, y + 2, stage.title, title, w - 4);
      // While the judge checks the agent's work, it says so instead of the status
      if (stage.judge && judging(s, i)) {
        g.text(x + 2, y + 4, '⚖ judge is checking', RUN, w - 4);
      } else {
        const glyph = st[i].state === 'running' ? `${spin(ui)} ` : '';
        g.text(x + 2, y + 4, glyph + st[i].status, st[i].state === 'todo' || st[i].state === 'done' ? DIM : title, w - 4);
      }
      if (i < 3) g.text(x + w + 1, y + 2, '──›', LINE);
    });
    anchor = 2 + 2 * (w + gap) + Math.floor(w / 2);
    y += 7;
  } else {
    // Too narrow for cards: the stages in one line
    let x = 2;
    STAGES.forEach((stage, i) => {
      const glyph = { done: '✓ ', running: `${spin(ui)} `, you: '⚑ ', failed: '✗ ', todo: '' }[st[i].state];
      const style = { done: DIM, running: RUN, you: YOU, failed: YOU, todo: DIM }[st[i].state];
      x = g.text(x, y, glyph + stage.title, style);
      if (i < 3) x = g.text(x, y, ' › ', LINE);
    });
    y += 2;
  }
  // What the pipeline's agents cost so far, under the cards on the right
  if (s.pipeline) {
    const cost = `cost so far ${dollars(pipelineCost(s))}`;
    g.text(g.width - 2 - cost.length, y - 1, cost, DIM);
  }
  return { y, anchor };
}

// The worker's output fills the rest, wrapped to the width. Scrolled back, it holds still until you follow again.
function workerOutput(g: Grid, s: Snapshot, ui: Ui, y: number): void {
  const rows = g.height - 2 - (y + 1);
  if (rows >= 2) {
    const all = (ui.log?.lines ?? s.log).flatMap((line) => splitToWidth(line, g.width - 6));
    const visible = rows - 1;
    if (ui.log) ui.log.scroll = Math.min(ui.log.scroll, Math.max(0, all.length - visible)); // the view keeps it within the output
    const scroll = ui.log?.scroll ?? 0;
    const title = ui.log ? `Worker output · ${scroll} lines back, paused ` : 'Worker output ';
    const x = g.text(4, y, title, ui.log ? BOLD : DIM);
    g.text(x, y, '─'.repeat(Math.max(0, g.width - x - 2)), LINE);
    const lines = all.slice(Math.max(0, all.length - visible - scroll), all.length - scroll);
    if (!lines.length) g.text(2, y + 1, 'Nothing yet. Everything the agents print shows up here, and in `flows logs`.', DIM);
    lines.forEach((line, i) => g.text(4, y + 1 + i, line, DIM, g.width - 6));
  }
}

function loopRow(g: Grid, loop: Loop, title: string, y: number, ui: Ui): void {
  const label = {
    you: ['⚑ needs you', YOU],
    failed: ['✗ failed', YOU],
    running: [`${spin(ui)} running`, RUN],
    done: ['✓ done', DIM],
    stopped: ['– stopped', DIM],
  }[loop.state] as [string, Style];
  let note = '';
  if (loop.state === 'you') note = loop.question ? 'the judge asks a question' : (loop.trouble ?? '');
  if (loop.state === 'failed') note = loop.failure ?? '';
  const attention = loop.state === 'you' || loop.state === 'failed';
  if (attention) {
    g.fill(3, y, g.width - 6, 1, { bg: 'you' });
    g.put(3, y, '▌', { fg: 'you' });
  }
  const wide = g.width >= 110;
  const titleWidth = wide ? Math.max(10, Math.min(48, g.width - 78)) : Math.max(10, g.width - 49);
  g.text(5, y, loop.ticket, DIM, 10);
  g.text(16, y, title, loop.state === 'done' || loop.state === 'stopped' ? DIM : BOLD, titleWidth);
  let x = 16 + titleWidth + 2;
  g.text(x, y, label[0], label[1], 13);
  x += 15;
  if (loop.run) g.text(x, y, `run ${loop.run}`, DIM);
  x += 12;
  if (wide) g.text(x, y, note, attention ? BOLD : DIM, g.width - x - 4);
}
