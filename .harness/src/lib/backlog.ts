// The tasks in backlog/, for the activities and for `flows watch`
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Task } from '../types/pipeline';

// Every backlog/TASK-<n>-<slug>.md, in order: TASK-1, TASK-2, ...
export function readBacklog(repoDir: string): Task[] {
  const dir = path.join(repoDir, 'backlog');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => /^(TASK-\d+)-(.*)\.md$/.exec(name))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(([name, id, slug]) => {
      const content = readFileSync(path.join(dir, name), 'utf8');
      const title = /^# (.+)$/m.exec(content)?.[1] ?? slug.replace(/-/g, ' ');
      const field = (key: string) => new RegExp(`^${key}:[ \\t]*(.*)$`, 'm').exec(content)?.[1].trim() || undefined;
      return {
        id,
        title,
        status: field('status')?.split(/\s/)[0] ?? '',
        blockedBy: field('blocked_by')?.match(/TASK-\d+/g) ?? [],
        blockedReason: field('blocked_reason'),
      };
    })
    .sort((a, b) => Number(a.id.split('-')[1]) - Number(b.id.split('-')[1]));
}

export const isDone = (backlog: Task[], id: string) => backlog.some((task) => task.id === id && task.status === 'done');

// The tasks that are blocked and can't start yet
export function waiting(backlog: Task[]): Task[] {
  return backlog.filter((task) => task.status === 'blocked' && !startable(backlog).includes(task));
}

// The tasks that can start: `ready`, or `blocked` only by tasks that are done by now. One that also
// waits for something outside the repo, its `blocked_reason`, stays blocked until someone marks it ready.
export function startable(backlog: Task[]): Task[] {
  return backlog.filter(
    (task) =>
      task.status === 'ready' ||
      (task.status === 'blocked' && task.blockedBy.length > 0 && !task.blockedReason && task.blockedBy.every((id) => isDone(backlog, id))),
  );
}
