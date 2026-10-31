import { ApplicationFailure, log, setHandler, workflowInfo } from '@temporalio/workflow';
import { MODELS } from '../config';
import type { PlanInput, PlanStatus } from '../types/pipeline';
import { addWorktree, currentBranch, headCommit, listTasks, mergeBranch, removeWorktree, requireCommitted, runAgent } from './support/activities';
import { skillFile, workPrompt } from './prompts';
import { planStatus } from './signals';
import { count, keepingUsage } from './support/usage';

// The plan agent: it uses the plan skill to turn a feature request or a specification into tasks in backlog/
export async function plan(input: PlanInput): Promise<string[]> {
  const status: PlanStatus = { step: 'planning', newTasks: [] };
  setHandler(planStatus, () => status);
  return keepingUsage(status, () => writeTasks(input, status));
}

async function writeTasks({ repoDir, agent, request, spec }: PlanInput, status: PlanStatus): Promise<string[]> {
  // The plan agent works in a worktree of its own. A retry throws away uncommitted changes, and that
  // never touches your checkout. Its tasks come onto the branch you're on now.
  if (spec) await requireCommitted(repoDir, spec);
  await requireCommitted(repoDir, skillFile('plan'));
  const into = await currentBranch(repoDir);
  const name = `plan-${workflowInfo().runId.slice(0, 8)}`;
  const branch = `agent/${name}`;
  const workDir = await addWorktree(repoDir, name, branch, await headCommit(repoDir));

  // Activity: read the tasks already in backlog/
  const before = await listTasks(workDir);

  // Activity: one agent run. It takes minutes, and it's the one you'll interrupt.
  log.info('== plan');
  const input = spec ? `Specification: ${spec}` : `Feature request: ${request}`;
  const run = await runAgent({ repoDir, workDir, agent, mode: 'write', model: MODELS.plan, step: 'plan', prompt: workPrompt('plan', input) });
  count(status, 'plan', run);

  // Activity: the tasks the plan agent added
  status.newTasks = (await listTasks(workDir)).filter((task) => !before.includes(task));

  // Activities: the tasks come onto your branch, and the worktree goes
  const problem = await mergeBranch(repoDir, branch, into);
  if (problem) {
    throw ApplicationFailure.nonRetryable(`The tasks are on ${branch}, not on ${into}: ${problem}. Then: git rebase ${into} ${branch} && git merge --ff-only ${branch}`);
  }
  await removeWorktree(repoDir, name, branch);
  status.step = 'done';
  return status.newTasks;
}
