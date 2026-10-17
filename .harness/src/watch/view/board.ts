// The Board tab: the tickets in backlog/ as cards, in a column per state
import { BOLD, DIM, Grid, LINE, RUN, Style, wrap, YOU } from '../grid';
import type { Card, Column, Snapshot } from '../model';
import { board, COLUMNS } from '../model';
import { spin } from './common';
import type { Ui } from './index';

// A finished loop whose branch waits for you to merge it
export function unmerged(card: Card | undefined): card is Card {
  return card?.note === 'ready to merge';
}

// The card picked on the board
export function selectedCard(s: Snapshot, ui: Ui): Card | undefined {
  return board(s).filter((c) => c.column === COLUMNS[ui.column])[ui.cursor[ui.column] ?? 0];
}

export function boardView(g: Grid, s: Snapshot, ui: Ui, top: number): void {
  const cards = board(s);
  if (!cards.length) {
    g.text(2, top, 'There are no tickets in backlog/ yet.', DIM);
    return;
  }
  // The selection starts at the first ticket, so it never sits in an empty column
  if (!cards.some((c) => c.column === COLUMNS[ui.column])) ui.column = Math.max(0, COLUMNS.findIndex((column) => cards.some((c) => c.column === column)));
  const colWidth = Math.floor((g.width - 4 - (COLUMNS.length - 1)) / COLUMNS.length);
  const bottom = g.height - 2;
  if (colWidth < 16) {
    // Too narrow for columns: one list, grouped by column
    let y = top;
    for (const column of COLUMNS) {
      const inColumn = cards.filter((c) => c.column === column);
      if (!inColumn.length || y >= bottom) continue;
      g.text(2, y++, `${column.toUpperCase()} ${inColumn.length}`, columnStyle(column));
      for (const card of inColumn) if (y < bottom) g.text(4, y++, `${card.ticket.id}  ${card.ticket.title} · ${card.note}`, cardStyle(card), g.width - 6);
      y++;
    }
    return;
  }
  COLUMNS.forEach((column, i) => {
    const x = 2 + i * (colWidth + 1);
    const inColumn = cards.filter((c) => c.column === column);
    g.box(x, top, colWidth, bottom - top, column === 'Needs you' ? { fg: 'you' } : LINE);
    if (column === 'Needs you') g.text(x + colWidth - 5, top, ' ⚑ ', YOU);
    // Running is blue only while a ticket is being implemented
    const style = column === 'Running' && !inColumn.length ? DIM : columnStyle(column);
    g.text(x + 2, top + 1, column.toUpperCase(), style);
    g.text(x + colWidth - 5, top + 1, String(inColumn.length).padStart(2), style);
    let y = top + 3;
    // ←→↑↓ select a ticket, the cards before `from` are scrolled out of view
    const room = bottom - 1 - y;
    // Full cards (id, title on up to two lines, status) while one fits, else compact ones (id and title on one line, status),
    // else one line per ticket
    const full = inColumn.map((card) => Math.min(wrap(card.ticket.title, colWidth - 6).length, 2) + 5);
    const compact = !inColumn.length || Math.max(...full) <= room ? false : room >= 4;
    const heights = compact ? inColumn.map(() => 4) : full;
    const selected = Math.min(ui.cursor[i] ?? 0, Math.max(0, inColumn.length - 1));
    ui.cursor[i] = selected;
    if (inColumn.length && Math.max(...heights) > room) {
      const rows = Math.max(1, room);
      let first = Math.min(ui.scroll[i] ?? 0, selected);
      if (selected >= first + rows) first = selected - rows + 1;
      ui.scroll[i] = first;
      inColumn.slice(first, first + rows).forEach((card, k) => {
        const glyph = { 'Needs you': '⚑ ', Running: `${spin(ui)} `, Done: '✓ ', Ready: '', Backlog: '' }[card.column];
        const picked = i === ui.column && first + k === selected;
        if (picked) g.fill(x + 1, y + k, colWidth - 2, 1, { bg: 'selected' });
        g.text(x + 2, y + k, `${glyph}${card.ticket.id.replace(/^TICKET-/, '#')} ${card.ticket.title}`, picked ? BOLD : card.column === 'Done' ? DIM : cardStyle(card), colWidth - 4);
      });
      return;
    }
    let from = Math.min(ui.scroll[i] ?? 0, selected);
    // The selected card scrolls into view
    while (from < selected && heights.slice(from, selected + 1).reduce((a, b) => a + b, 0) > room) from++;
    ui.scroll[i] = from;
    if (from > 0) g.text(x + 2, y - 1, `▲ ${from} above`, DIM);
    inColumn.forEach((card, n) => {
      if (n < from) return;
      const lines = compact ? [`${card.ticket.id}  ${card.ticket.title}`] : wrap(card.ticket.title, colWidth - 6).slice(0, 2);
      const h = compact ? 4 : lines.length + 4;
      if (y + h > bottom - 1) {
        if (y < bottom - 1) g.text(x + 2, y, `▼ ${inColumn.length - n} more`, DIM);
        y = bottom;
        return;
      }
      const attention = card.column === 'Needs you';
      if (attention) g.fill(x + 1, y, colWidth - 2, h, { bg: 'you' });
      const picked = i === ui.column && n === selected;
      g.box(x + 1, y, colWidth - 2, h, picked ? { fg: 'text' } : attention ? { fg: 'you' } : card.column === 'Running' ? { fg: 'run' } : LINE);
      g.text(x + 3, y + 1, card.ticket.id, picked ? BOLD : DIM);
      if (compact) g.text(x + 3 + card.ticket.id.length + 2, y + 1, card.ticket.title, card.column === 'Done' ? DIM : BOLD, colWidth - 8 - card.ticket.id.length);
      else lines.forEach((line, k) => g.text(x + 3, y + 2 + k, line, card.column === 'Done' ? DIM : BOLD, colWidth - 6));
      const glyph = { 'Needs you': '⚑ ', Running: `${spin(ui)} `, Done: '✓ ', Ready: '', Backlog: '' }[card.column];
      g.text(x + 3, y + (compact ? 2 : 2 + lines.length), glyph + card.note, cardStyle(card), colWidth - 6);
      y += compact ? h : h + 1;
    });
  });
}

function columnStyle(column: Column): Style {
  return column === 'Needs you' ? YOU : column === 'Running' ? RUN : DIM;
}

function cardStyle(card: Card): Style {
  return card.column === 'Needs you' ? YOU : card.column === 'Running' ? RUN : DIM;
}
