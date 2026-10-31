import { ApplicationFailure, log, setHandler, workflowInfo } from '@temporalio/workflow';
import { MODELS } from '../config';
import type { DesignInput, DesignStatus } from '../types/pipeline';
import { addWorktree, currentBranch, designProblem, headCommit, mergeBranch, removeWorktree, requireCommitted, runAgent } from './support/activities';
import { skillFile, workPrompt } from './prompts';
import { designStatus } from './signals';
import { count, keepingUsage } from './support/usage';

// The design agent on its own: it uses the design skill to write the design next to a specification in specs/.
// One run, without a judge, like `flows plan`. In the pipeline, the design phase runs between the two checkpoints.
export async function design(input: DesignInput): Promise<string> {
  const status: DesignStatus = { step: 'designing' };
  setHandler(designStatus, () => status);
  return keepingUsage(status, () => writeDesign(input, status));
}

async function writeDesign({ repoDir, agent, spec }: DesignInput, status: DesignStatus): Promise<string> {
  // The design agent works in a worktree of its own. A retry throws away uncommitted changes, and that never
  // touches your checkout. Its design comes onto the branch you're on now.
  await requireCommitted(repoDir, spec);
  await requireCommitted(repoDir, skillFile('design'));
  const into = await currentBranch(repoDir);
  const name = `design-${workflowInfo().runId.slice(0, 8)}`;
  const branch = `agent/${name}`;
  const workDir = await addWorktree(repoDir, name, branch, await headCommit(repoDir));
  const before = await headCommit(workDir);

  // Activity: one agent run. It takes minutes, and it's the one you'll interrupt.
  log.info('== design');
  const run = await runAgent({ repoDir, workDir, agent, mode: 'write', model: MODELS.design, step: 'design', prompt: workPrompt('design', `Specification: ${spec}`) });
  count(status, 'design', run);

  // Activity: the same rule as in the pipeline, plain code: one design.md next to the specification, no code
  const problem = await designProblem(workDir, before, spec);
  if (problem) throw ApplicationFailure.nonRetryable(`The design isn't right: ${problem} It's on ${branch}. Run flows cleanup and try again.`);

  // Activities: the design comes onto your branch, and the worktree goes
  const notMerged = await mergeBranch(repoDir, branch, into);
  if (notMerged) {
    throw ApplicationFailure.nonRetryable(`The design is on ${branch}, not on ${into}: ${notMerged}. Then: git rebase ${into} ${branch} && git merge --ff-only ${branch}`);
  }
  await removeWorktree(repoDir, name, branch);
  status.step = 'done';
  return spec.replace(/[^/]*$/, 'design.md');
}
