// `flows ralph`: one Ralph loop on a task, in a worktree of its own
import { Client } from '@temporalio/client';
import { branchOf, worktreeName } from '../config';
import type { RalphResult } from '../types/pipeline';
import { agent, repoDir, resultWithQuestions, startOrFollow, workflowFailure } from './common';

export async function ralph(client: Client, task: string | undefined, maxRuns: number | undefined, detach: boolean): Promise<number> {
  if (!task || Number.isNaN(maxRuns)) {
    console.error('Usage: flows ralph <task> [--runs <n>] [--detach]');
    return 1;
  }
  const handle = await startOrFollow(client, 'ralph', `ralph-${task}`, { repoDir: repoDir(), agent, task, maxRuns });
  if (detach) return 0;
  console.log(`The loop works in .harness/worktrees/${worktreeName(task)}, on the branch ${branchOf(task)}.`);
  console.log('The agent output shows up in the worker. Ctrl+C here only stops waiting, the loop goes on.');
  try {
    if ((await resultWithQuestions<RalphResult>(handle)).done) {
      console.log(`${task} is done.`);
      return 0;
    }
    console.log(`${task} isn't done yet. See .harness/progress.md, and run \`flows ralph ${task}\` to go on.`);
    return maxRuns === undefined ? 1 : 0;
  } catch (err) {
    console.log(`The loop stopped: ${workflowFailure(err)}`);
    return 1;
  }
}
