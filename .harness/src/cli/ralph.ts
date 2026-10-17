// `flows ralph`: one Ralph loop on a ticket, in a worktree of its own
import { Client } from '@temporalio/client';
import { branchOf, worktreeName } from '../shared';
import type { RalphResult } from '../types/pipeline';
import { agent, repoDir, resultWithQuestions, startOrFollow, workflowFailure } from './common';

export async function ralph(client: Client, ticket: string | undefined, maxRuns: number | undefined, detach: boolean): Promise<number> {
  if (!ticket || Number.isNaN(maxRuns)) {
    console.error('Usage: flows ralph <ticket> [--runs <n>] [--detach]');
    return 1;
  }
  const handle = await startOrFollow(client, 'ralph', `ralph-${ticket}`, { repoDir: repoDir(), agent, ticket, maxRuns });
  if (detach) return 0;
  console.log(`The loop works in .harness/worktrees/${worktreeName(ticket)}, on the branch ${branchOf(ticket)}.`);
  console.log('The agent output shows up in the worker. Ctrl+C here only stops waiting, the loop goes on.');
  try {
    if ((await resultWithQuestions<RalphResult>(handle)).done) {
      console.log(`${ticket} is done.`);
      return 0;
    }
    console.log(`${ticket} isn't done yet. See .harness/progress.md, and run \`flows ralph ${ticket}\` to go on.`);
    return maxRuns === undefined ? 1 : 0;
  } catch (err) {
    console.log(`The loop stopped: ${workflowFailure(err)}`);
    return 1;
  }
}
