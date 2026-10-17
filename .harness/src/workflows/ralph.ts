import { setHandler } from '@temporalio/workflow';
import { branchOf, worktreeName } from '../shared';
import type { RalphInput, RalphResult, RalphStatus } from '../types/pipeline';
import { MAX_RUNS } from '../types/pipeline';
import { addWorktree, failingHiddenTests, headCommit, progressLeft, runTests, ticketDone } from './activities';
import { runPhase } from './phase';
import { ralphStatus } from './signals';
import { keepingUsage, usageOnly } from './usage';

// Ralph is one phase: the agent takes one small step per run, until the ticket is done. It stops when 3 runs
// in a row are rejected, or after 30 runs, a backstop.
// One run in `flows watch` (or `--runs 1`) sets maxRuns to 1. Returns whether the ticket is done, and what its runs cost.
export async function ralph(input: RalphInput): Promise<RalphResult> {
  const status: RalphStatus = { ticket: input.ticket };
  setHandler(ralphStatus, () => status);
  const done = await keepingUsage(status, () => loop(input, status));
  return { done, ...usageOnly(status) };
}

async function loop({ repoDir, agent, ticket, maxRuns = MAX_RUNS, base, unattended, acceptance }: RalphInput, status: RalphStatus): Promise<boolean> {
  // The loop works in a worktree of its own, on the branch agent/<ticket>: its commits, and the reset of a
  // retry, stay out of your checkout. In the pipeline it starts fresh from `base`. On its own (`flows ralph`)
  // it goes on where an earlier run on the same ticket stopped.
  const fresh = base !== undefined;
  const workDir = await addWorktree(repoDir, worktreeName(ticket), branchOf(ticket), base ?? (await headCommit(repoDir)), fresh);

  if (await ticketDone(workDir, ticket)) return true; // also fails the workflow right here if the ticket doesn't exist

  // Whether the ticket was done the last time the phase asked, after a PASS. The phase stops right after
  // it asks, so that's also whether it's done now.
  let done = false;
  await runPhase(repoDir, workDir, agent, {
    name: 'implement', // the implement skill, checked with the judge skill
    input: `Your ticket: ${ticket}`,
    maxRuns,
    unattended,
    // If the tests fail, there's no need to ask the judge agent
    check: async () => {
      const tests = await runTests(workDir);
      if (!tests.pass) return `The tests fail. The end of their output:\n\n${tests.tail}`;
      // The rest only checks a ticket that is done: until then, the next run takes the next step
      if (!(await ticketDone(workDir, ticket))) return null;
      // A finished ticket has no progress.md: the review reads it as a loop that didn't finish
      if (await progressLeft(workDir)) {
        return 'The ticket is done, but .harness/progress.md is still there. Copy the decisions later tickets need to .harness/learnings.md, and delete progress.md.';
      }
      // Evals only: the acceptance tests that still fail are criteria it missed
      if (acceptance) {
        const failing = await failingHiddenTests(acceptance.repoDir, workDir, acceptance.task);
        if (failing.length) return `The ticket is done, but acceptance tests still fail: ${failing.join(', ')}. Their names say what they check: find what your change misses, and cover it with your own tests too.`;
      }
      return null;
    },
    done: async () => (done = await ticketDone(workDir, ticket)),
  }, status);
  return done;
}
