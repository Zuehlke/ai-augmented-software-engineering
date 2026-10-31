import { ApplicationFailure, condition, executeChild, setHandler, workflowInfo } from '@temporalio/workflow';
import { branchOf, MODELS, worktreeName } from '../config';
import type { Checkpoint, PipelineInput, PipelineStatus, PipelineStep } from '../types/pipeline';
import { addWorktree, blockedTasks, branchDiffs, checkoutProblem, currentBranch, designProblem, headCommit, listTasks, mergeBranch, readyTasks, removeTasks, requireCommitted, removeWorktree, runAgent, runTests, specificationOf } from './support/activities';
import { failureMessage } from './support/failure';
import { runPhase } from './phase';
import { designInput, planInput, researchInput, reviewPrompt, skillFile } from './prompts';
import { ralph } from './ralph';
import { approveSpecificationSignal, approveTasksSignal, decideMergeSignal, pipelineStatus, reviseSignal } from './signals';
import { findVerdict } from './support/text';
import { add, count, keepingUsage, usageOf } from './support/usage';

// research → you approve the specification → design → plan → dispatch → you approve the plan and its tasks →
// implement, one Ralph loop per task → review → you decide → merge. At both approvals you can send it back with
// your feedback instead.
export async function pipeline(input: PipelineInput): Promise<PipelineStatus> {
  const status: PipelineStatus = { step: 'researching', tasks: [], unfinished: [], review: '', approvedBranches: [], merged: [], notMerged: [] };
  const decisions: Decisions = {}; // as the signals set them
  setHandler(pipelineStatus, () => status);
  setHandler(approveSpecificationSignal, () => void (decisions.handoff = { on: 'specification', tasks: [] }));
  setHandler(approveTasksSignal, (tasks) => void (decisions.handoff = { on: 'plan', tasks }));
  setHandler(reviseSignal, (on, feedback) => void (decisions.handoff = { on, tasks: [], feedback }));
  setHandler(decideMergeSignal, (yes) => {
    decisions.merge = yes;
    status.mergeProblem = undefined;
  });
  return keepingUsage(status, () => steps(input, status, decisions));
}

// Your decision at a checkpoint: approved, with the tasks to build at the plan's, or sent back with feedback
interface Decision {
  on: Checkpoint;
  tasks: string[];
  feedback?: string;
}

interface Decisions {
  handoff?: Decision;
  merge?: boolean;
}

async function steps({ repoDir, agent, request, unattended, acceptance }: PipelineInput, status: PipelineStatus, decisions: Decisions): Promise<PipelineStatus> {
  // Everything it brings comes onto the branch you start it on
  const into = await currentBranch(repoDir);
  status.into = into;

  // The research, the design and the plan agent work in a worktree of their own, like the implement loops. A
  // retry throws away uncommitted changes, and that never touches your checkout.
  const planName = `pipeline-${workflowInfo().runId.slice(0, 8)}`;
  const planBranch = `agent/${planName}`;
  const planDir = await addWorktree(repoDir, planName, planBranch, await headCommit(repoDir));

  // ✋ A checkpoint: what the agents wrote so far comes onto your branch, so you read it there, and it waits for
  // your decision on it. If your checkout can't take it, for example because of uncommitted changes, it says
  // why, and tries again with your next decision. `merged` runs once it's on your branch.
  const checkpoint = async (on: Checkpoint, waiting: PipelineStep, merged?: () => Promise<void>): Promise<Decision> => {
    for (;;) {
      decisions.handoff = undefined; // only a decision on this checkpoint, from now on, counts
      status.mergeProblem = (await mergeBranch(repoDir, planBranch, into)) ?? undefined;
      if (!status.mergeProblem) await merged?.();
      status.step = waiting;
      await condition(() => decisions.handoff?.on === on);
      if (!status.mergeProblem) return decisions.handoff!;
    }
  };
  const sentBack = (on: Checkpoint) => (status.revised = { ...status.revised, [on]: (status.revised?.[on] ?? 0) + 1 });

  // research: an agent writes the specification, and a judge checks it. Plain code checks first which one it wrote:
  // one, a new one, or the one it revises. From then on, the pipeline names it to every agent.
  // ✋ Checkpoint 1: you approve the specification, or send it back with feedback, and the research agent revises it
  let feedback: string | undefined;
  for (;;) {
    status.step = 'researching';
    const before = await headCommit(planDir);
    const written = async () => specificationOf(planDir, before, status.specification);
    await runPhase(repoDir, planDir, agent, {
      name: 'research', // the research skill, checked with the judge skill
      input: researchInput(request, feedback),
      maxRuns: 3,
      unattended,
      check: async () => (await written()).problem ?? null,
    }, status);
    status.specification = (await written()).spec;
    if (unattended) break;
    const decision = await checkpoint('specification', 'waiting for your specification approval');
    if (decision.feedback === undefined) break;
    feedback = decision.feedback;
    sentBack('specification');
  }

  // design: an agent writes the technical decisions the tasks share next to the specification, and a judge
  // checks them. plan: an agent writes the tasks along the design, and a judge checks them.
  // ✋ Checkpoint 2: you approve the plan with the tasks to build, or send it back with feedback: its tasks go,
  // the design agent revises the design, and the plan agent cuts the tasks again.
  feedback = undefined;
  let approved: string[];
  for (;;) {
    status.step = 'designing';
    const before = await headCommit(planDir);
    await runPhase(repoDir, planDir, agent, {
      name: 'design', // the design skill, checked with the judge skill
      input: designInput(status.specification!, feedback),
      maxRuns: 3,
      unattended,
      check: () => designProblem(planDir, before, status.specification!),
    }, status);

    status.step = 'planning';
    const earlier = await listTasks(planDir);
    await runPhase(repoDir, planDir, agent, {
      name: 'plan', // the plan skill, checked with the judge skill
      input: planInput(status.specification!, feedback),
      maxRuns: 3,
      unattended,
    }, status);
    const written = (await listTasks(planDir)).filter((task) => !earlier.includes(task));

    // dispatch: no agent, a rule. It picks the tasks that can start: `ready`, or blocked only by tasks that
    // are done already. A task that waits for a task of this pipeline waits for a later pipeline.
    const dispatch = async () => void (status.tasks = await readyTasks(repoDir));
    if (unattended) {
      // Nobody reads it, nobody would fix a checkout that can't take it: all the ready tasks go on
      const problem = await mergeBranch(repoDir, planBranch, into);
      if (problem) {
        throw ApplicationFailure.nonRetryable(`The specification, the design and the tasks are on ${planBranch}, not on ${into}: ${problem}. Run flows cleanup and start again.`);
      }
      await dispatch();
      approved = status.tasks;
      break;
    }
    const decision = await checkpoint('plan', 'waiting for your plan approval', dispatch);
    if (decision.feedback === undefined) {
      approved = decision.tasks;
      break;
    }
    await removeTasks(planDir, written); // committed: they're on your branch already
    feedback = decision.feedback;
    sentBack('plan');
  }
  await removeWorktree(repoDir, planName, planBranch);

  // implement: one Ralph loop per task, each in its own worktree, all at the same time, all from the same
  // commit. A loop that fails doesn't stop the others: only the finished tasks go on to review. The loops
  // are named after the pipeline, pipeline-TASK-5, so pipelines that run at the same time, in the evals, don't collide.
  status.step = 'implementing';
  const base = await headCommit(repoDir);
  const loops = approved.map((task) => {
    const workflowId = `${workflowInfo().workflowId}-${task}`;
    return executeChild(ralph, { workflowId, args: [{ repoDir, agent, task, base, unattended, acceptance }] });
  });
  const results = await Promise.allSettled(loops);
  const finished: string[] = [];
  results.forEach((result, i) => {
    const task = approved[i];
    add(status, result.status === 'fulfilled' ? result.value : usageOf(result.reason)); // a failed loop's runs cost too
    if (result.status === 'fulfilled' && result.value.done) finished.push(task);
    else if (result.status === 'fulfilled') status.unfinished.push(`${task}: out of runs, not done`);
    else status.unfinished.push(`${task}: ${failureMessage(result.reason)}`);
  });
  if (!finished.length) return finish(repoDir, status);

  // review: a fresh, read-only agent gets every finished branch's changes. Its verdict per branch is its last
  // line about it: `agent/task-5: APPROVE` or `agent/task-5: REJECT: <why>`. A rejected branch isn't merged.
  const branches = finished.map(branchOf);
  await requireCommitted(repoDir, skillFile('review'));
  await requireCommitted(repoDir, skillFile('change-quality'));
  status.step = 'reviewing';
  const prompt = reviewPrompt(await branchDiffs(repoDir, branches));
  const run = await runAgent({ repoDir, agent, mode: 'read', model: MODELS.review, step: 'review', prompt });
  status.review = count(status, 'review', run);
  const approves = (branch: string) => findVerdict(status.review, ['APPROVE', 'REJECT'], branch)?.kind === 'APPROVE';
  status.approvedBranches = branches.filter(approves);

  // ✋ Checkpoint 2: waits until `flows merge` sends your decision. If your checkout can't take the merge
  // right now, for example because of uncommitted changes, it says why and waits for your decision again.
  // Unattended, it merges what the review approved. Nobody would fix a checkout that can't take it.
  if (unattended) {
    const problem = await checkoutProblem(repoDir, into);
    if (problem) throw ApplicationFailure.nonRetryable(`It can't merge: ${problem}`);
  }
  while (!unattended) {
    status.step = 'waiting for your merge decision';
    await condition(() => decisions.merge !== undefined);
    if (!decisions.merge) return finish(repoDir, status);
    status.mergeProblem = (await checkoutProblem(repoDir, into)) ?? undefined;
    if (!status.mergeProblem) break;
    decisions.merge = undefined; // your checkout couldn't take the merge: wait for your decision again
  }

  // merge: rebases the approved branches onto your branch and fast-forwards it, one after the other.
  // A merged branch's worktree goes. The others stay, so you can look at them.
  status.step = 'merging';
  for (const task of finished) {
    const branch = branchOf(task);
    if (!status.approvedBranches.includes(branch)) continue;
    const why = await mergeBranch(repoDir, branch, into);
    if (why) {
      status.notMerged.push(`${branch}: ${why}`); // for example, it conflicts with a branch merged before it
    } else {
      status.merged.push(branch);
      await removeWorktree(repoDir, worktreeName(task), branch);
    }
  }
  return finish(repoDir, status);
}

// The tasks that never got to start, because what blocks them wasn't merged, and the tests of what was merged
async function finish(repoDir: string, status: PipelineStatus): Promise<PipelineStatus> {
  status.unfinished.push(...(await blockedTasks(repoDir, status.tasks)));
  if (status.merged.length) status.testsPass = (await runTests(repoDir)).pass;
  status.step = 'done';
  return status;
}
