// The tickets in backlog/, for the activities and for `flows watch`
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Ticket } from './types/pipeline';

// Every backlog/TICKET-<n>-<slug>.md, in order: TICKET-1, TICKET-2, ...
export function readBacklog(repoDir: string): Ticket[] {
  const dir = path.join(repoDir, 'backlog');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => /^(TICKET-\d+)-(.*)\.md$/.exec(name))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(([name, id, slug]) => {
      const content = readFileSync(path.join(dir, name), 'utf8');
      const title = /^# (.+)$/m.exec(content)?.[1] ?? slug.replace(/-/g, ' ');
      const field = (key: string) => new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(content)?.[1].trim() || undefined;
      return {
        id,
        title,
        status: field('status')?.split(/\s/)[0] ?? '',
        blockedBy: field('blocked_by')?.match(/TICKET-\d+/g) ?? [],
        blockedReason: field('blocked_reason'),
      };
    })
    .sort((a, b) => Number(a.id.split('-')[1]) - Number(b.id.split('-')[1]));
}

export const isDone = (backlog: Ticket[], id: string) => backlog.some((ticket) => ticket.id === id && ticket.status === 'done');

// The tickets that are blocked and can't start yet
export function waiting(backlog: Ticket[]): Ticket[] {
  return backlog.filter((ticket) => ticket.status === 'blocked' && !startable(backlog).includes(ticket));
}

// The tickets that can start: `ready`, or `blocked` only by tickets that are done by now. One that also
// waits for something outside the repo, its `blocked_reason`, stays blocked until someone marks it ready.
export function startable(backlog: Ticket[]): Ticket[] {
  return backlog.filter(
    (ticket) =>
      ticket.status === 'ready' ||
      (ticket.status === 'blocked' && ticket.blockedBy.length > 0 && !ticket.blockedReason && ticket.blockedBy.every((id) => isDone(backlog, id))),
  );
}
