import { rm } from 'node:fs/promises';
import path from 'node:path';
import { ApplicationFailure } from '@temporalio/common';
import { isDone, readBacklog, startable, waiting } from '../lib/backlog';
import { git } from './exec';

// Activities on the tasks in backlog/: which can start, which wait, and the plan agent's tasks going again.

// The ids of all tasks in backlog/, in order: TASK-1, TASK-2, ...
export async function listTasks(repoDir: string): Promise<string[]> {
  return readBacklog(repoDir).map((task) => task.id);
}

// Throws away tasks a pipeline's plan agent wrote, in one commit, before it plans again with your feedback.
// A commit and not a reset: the tasks are on your branch already, from the plan's checkpoint. Safe to retry.
export async function removeTasks(workDir: string, tasks: string[]): Promise<void> {
  const files = (await git(workDir, 'ls-tree', '--name-only', 'HEAD', 'backlog/')).split('\n').filter(Boolean);
  const theirs = files.filter((file) => tasks.some((id) => path.basename(file).startsWith(`${id}-`)));
  if (theirs.length) await git(workDir, 'rm', '-q', '--ignore-unmatch', '--', ...theirs);
  const staged = (await git(workDir, 'diff', '--cached', '--name-only')).trim();
  if (staged) await git(workDir, 'commit', '-qm', `chore(backlog): remove ${tasks.join(', ')} to plan them again`);
}

// True when the task's file in backlog/ says `status: done`. Fails for good if there is no such task.
export async function taskDone(repoDir: string, task: string): Promise<boolean> {
  const found = readBacklog(repoDir).find((t) => t.id === task);
  if (!found) {
    throw ApplicationFailure.nonRetryable(`There is no ${task} in backlog/.`);
  }
  return found.status === 'done';
}

// The ids of the tasks in backlog/ that can start: marked `status: ready`, or blocked only by tasks
// that are done by now
export async function readyTasks(repoDir: string): Promise<string[]> {
  return startable(readBacklog(repoDir)).map((task) => task.id);
}

// The tasks in backlog/ that wait, and for what: `TASK-6: <why>`. Only the ones blocked by one of
// `tasks`, the tasks a pipeline worked on, not what's left from earlier work.
export async function blockedTasks(repoDir: string, tasks: string[]): Promise<string[]> {
  const backlog = readBacklog(repoDir);
  return waiting(backlog)
    .filter((task) => task.blockedBy.some((id) => tasks.includes(id)))
    .map((task) => {
      const notDone = task.blockedBy.filter((id) => !isDone(backlog, id)).map((id) => `${id} isn't done`);
      const why = [...notDone, task.blockedReason].filter(Boolean).join(', ');
      return `${task.id}: still blocked, ${why}`;
    });
}
