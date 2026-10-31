// `flows design --spec <specification>`: the design agent writes the design next to a specification in specs/
import path from 'node:path';
import { Client } from '@temporalio/client';
import { agent, repoDir, startOrFollow } from './common';

export async function design(client: Client, spec: string | undefined): Promise<number> {
  if (!spec) {
    console.error('Usage: flows design --spec specs/<slug>/specification.md');
    return 1;
  }
  // The design agent works in a worktree, so the specification's path has to be relative to the repository
  const root = repoDir();
  const handle = await startOrFollow(client, 'design', 'design', { repoDir: root, agent, spec: path.relative(root, path.resolve(spec)) });
  console.log('The agent output shows up in the worker. Ctrl+C here only stops waiting, the workflow goes on.');
  const file: string = await handle.result();
  console.log(`The design agent wrote ${file}.`);
  return 0;
}
