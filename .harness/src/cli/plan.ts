// `flows plan`: the plan agent turns a feature request, or a specification, into tasks
import path from 'node:path';
import { Client } from '@temporalio/client';
import { agent, repoDir, startOrFollow } from './common';

export async function plan(client: Client, request: string | undefined, spec: string | undefined): Promise<number> {
  if (!request && !spec) {
    console.error('Usage: flows plan "<feature request>" or flows plan --spec <specification>');
    return 1;
  }
  // The plan agent works in a worktree, so the specification's path has to be relative to the repository
  const root = repoDir();
  const relativeSpec = spec && path.relative(root, path.resolve(spec));
  const handle = await startOrFollow(client, 'plan', 'plan', { repoDir: root, agent, request, spec: relativeSpec });
  console.log('The agent output shows up in the worker. Ctrl+C here only stops waiting, the workflow goes on.');
  const tasks: string[] = await handle.result();
  console.log(`The plan agent wrote ${tasks.join(' ') || 'no tasks'}, see backlog/.`);
  return 0;
}
