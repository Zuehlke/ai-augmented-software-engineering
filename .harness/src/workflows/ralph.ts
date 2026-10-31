import { setHandler } from '@temporalio/workflow';
import { branchOf, MAX_RUNS, worktreeName } from '../config';
import type { RalphInput, RalphResult, RalphStatus } from '../types/pipeline';
import { addWorktree, failingHiddenTests, headCommit, progressLeft, runTests, taskDone } from './support/activities';
import { runPhase } from './phase';
import { ralphStatus } from './signals';
import { keepingUsage, usageOnly } from './support/usage';

// Ralph is one phase: the agent takes one small step per run, until the task is done. It stops when 3 runs
// in a row are rejected, or after 30 runs, a backstop.
// One run in `flows watch` (or `--runs 1`) sets maxRuns to 1. Returns whether the task is done, and what its runs cost.
export async function ralph(input: RalphInput): Promise<RalphResult> {
  const status: RalphStatus = { task: input.task };
  setHandler(ralphStatus, () => status);
  const done = await keepingUsage(status, () => loop(input, status));
  return { done, ...usageOnly(status) };
}

async function loop({ repoDir, agent, task, maxRuns = MAX_RUNS, base, unattended, acceptance }: RalphInput, status: RalphStatus): Promise<boolean> {
  // The loop works in a worktree of its own, on the branch agent/<task>: its commits, and the reset of a
  // retry, stay out of your checkout. In the pipeline it starts fresh from `base`. On its own (`flows ralph`)
  // it goes on where an earlier run on the same task stopped.
  const fresh = base !== undefined;
  const workDir = await addWorktree(repoDir, worktreeName(task), branchOf(task), base ?? (await headCommit(repoDir)), fresh);

  if (await taskDone(workDir, task)) return true; // also fails the workflow right here if the task doesn't exist

  // Whether the task was done the last time the phase asked, after a PASS. The phase stops right after
  // it asks, so that's also whether it's done now.
  let done = false;
  await runPhase(repoDir, workDir, agent, {
    name: 'implement', // the implement skill, checked with the judge skill
    input: `Your task: ${task}`,
    maxRuns,
    unattended,
    // If the tests fail, there's no need to ask the judge agent
    check: async () => {
      const tests = await runTests(workDir);
      if (!tests.pass) return `The tests fail. The end of their output:\n\n${tests.tail}`;
      // The rest only checks a task that is done: until then, the next run takes the next step
      if (!(await taskDone(workDir, task))) return null;
      // A finished task has no progress.md: the review reads it as a loop that didn't finish
      if (await progressLeft(workDir)) {
        return 'The task is done, but .harness/progress.md is still there. Copy the decisions later tasks need to .harness/learnings.md, and delete progress.md.';
      }
      // Evals only: the acceptance tests that still fail are criteria it missed
      if (acceptance) {
        const failing = await failingHiddenTests(acceptance.repoDir, workDir, acceptance.task);
        if (failing.length) return `The task is done, but acceptance tests still fail: ${failing.join(', ')}. Their names say what they check: find what your change misses, and cover it with your own tests too.`;
      }
      return null;
    },
    done: async () => (done = await taskDone(workDir, task)),
  }, status);
  return done;
}
