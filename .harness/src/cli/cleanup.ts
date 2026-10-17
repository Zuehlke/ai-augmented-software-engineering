// `flows cleanup`: back to a clean start, without losing work that isn't merged
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Client } from '@temporalio/client';
import { TASK_QUEUE } from '../shared';
import { repoDir } from './common';

// Stops every running workflow, removes the agents' worktrees, and deletes their branches once they're merged.
// An unmerged branch has work on it that isn't anywhere else: it stays, you decide. `forget` also deletes the
// finished workflows from Temporal, so flows watch starts empty: what `task lab/...` does before it switches labs.
export async function cleanup(client: Client, forget = false): Promise<number> {
  const running: string[] = [];
  for await (const { workflowId } of client.workflow.list({ query: `ExecutionStatus = "Running" AND TaskQueue = "${TASK_QUEUE}"` })) {
    running.push(workflowId);
  }
  for (const workflowId of running) {
    // A pipeline's loops stop with it, so some are already stopped
    await client.workflow.getHandle(workflowId).terminate('flows cleanup').then(() => console.log(`Stopped ${workflowId}.`), () => {});
  }
  if (forget) {
    const all: string[] = [];
    for await (const { workflowId } of client.workflow.list({ query: `TaskQueue = "${TASK_QUEUE}"` })) all.push(workflowId);
    for (const workflowId of new Set(all)) {
      await client.workflowService.deleteWorkflowExecution({ namespace: 'default', workflowExecution: { workflowId } }).catch(() => {});
    }
    if (all.length) console.log(`Forgot ${new Set(all).size} workflows: flows watch starts empty.`);
  }
  const root = repoDir();
  const worktrees = path.join(root, '.harness/worktrees');
  if (existsSync(worktrees)) {
    for (const dir of readdirSync(worktrees)) {
      try {
        execFileSync('git', ['worktree', 'remove', '--force', path.join(worktrees, dir)], { cwd: root, stdio: 'inherit' });
      } catch {
        console.log(`Couldn't remove .harness/worktrees/${dir}, it may not be a worktree. Remove it yourself.`); // the others still go
      }
    }
  }
  const branches = execFileSync('git', ['branch', '--list', 'agent/*', '--format=%(refname:short)'], { cwd: root, encoding: 'utf8' });
  const unmerged: string[] = [];
  for (const branch of branches.split('\n').filter(Boolean)) {
    try {
      execFileSync('git', ['branch', '-d', branch], { cwd: root, stdio: 'ignore' }); // only if it's merged
    } catch {
      unmerged.push(branch);
    }
  }
  for (const branch of unmerged) {
    console.log(`Kept ${branch}, it isn't merged. Look at it: git log -p HEAD..${branch}. Delete it: git branch -D ${branch}`);
  }
  console.log('Cleaned up.');
  return 0;
}
