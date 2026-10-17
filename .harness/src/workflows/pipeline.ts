import { ApplicationFailure, condition, executeChild, setHandler, workflowInfo } from '@temporalio/workflow';
import { branchOf, MODELS, worktreeName } from '../shared';
import type { PipelineInput, PipelineStatus } from '../types/pipeline';
import { addWorktree, blockedTickets, branchDiffs, checkoutProblem, currentBranch, headCommit, mergeBranch, readyTickets, requireCommitted, removeWorktree, runAgent, runTests } from './activities';
import { failureMessage } from './failure';
import { runPhase } from './phase';
import { reviewPrompt, skillFile } from './prompts';
import { ralph } from './ralph';
import { approveTicketsSignal, decideMergeSignal, pipelineStatus } from './signals';
import { findVerdict } from './text';
import { add, count, keepingUsage, usageOf } from './usage';

// research → plan → dispatch → you approve the tickets → implement, one Ralph loop per ticket → review → you decide → merge
export async function pipeline(input: PipelineInput): Promise<PipelineStatus> {
  const status: PipelineStatus = { step: 'researching', tickets: [], unfinished: [], review: '', approvedBranches: [], merged: [], notMerged: [] };
  const decisions: { approved?: string[]; merge?: boolean } = {}; // as the signals set them
  setHandler(pipelineStatus, () => status);
  setHandler(approveTicketsSignal, (tickets) => void (decisions.approved = tickets));
  setHandler(decideMergeSignal, (yes) => {
    decisions.merge = yes;
    status.mergeProblem = undefined;
  });
  return keepingUsage(status, () => steps(input, status, decisions));
}

async function steps({ repoDir, agent, request, unattended, acceptance }: PipelineInput, status: PipelineStatus, decisions: { approved?: string[]; merge?: boolean }): Promise<PipelineStatus> {
  // Everything it brings comes onto the branch you start it on
  const into = await currentBranch(repoDir);
  status.into = into;

  // The research and the plan agent work in a worktree of their own, like the implement loops. A retry
  // throws away uncommitted changes, and that never touches your checkout.
  const planName = `pipeline-${workflowInfo().runId.slice(0, 8)}`;
  const planBranch = `agent/${planName}`;
  const planDir = await addWorktree(repoDir, planName, planBranch, await headCommit(repoDir));

  // research: an agent writes the specification, and a judge checks it
  await runPhase(repoDir, planDir, agent, {
    name: 'research', // the research skill, checked with the judge skill
    input: `Feature request: ${request}`,
    maxRuns: 3,
    unattended,
  }, status);

  // plan: an agent writes the tickets, and a judge checks them
  status.step = 'planning';
  await runPhase(repoDir, planDir, agent, {
    name: 'plan', // the plan skill, checked with the judge skill
    input: 'Specification: the one the research agent just wrote in specs/',
    maxRuns: 3,
    unattended,
  }, status);

  // The specification and the tickets come onto your branch, so you can read them before you approve
  const problem = await mergeBranch(repoDir, planBranch, into);
  if (problem) {
    throw ApplicationFailure.nonRetryable(`The specification and the tickets are on ${planBranch}, not on ${into}: ${problem}. Run flows cleanup and start again.`);
  }
  await removeWorktree(repoDir, planName, planBranch);

  // dispatch: no agent, a rule. It picks the tickets that can start: `ready`, or blocked only by tickets that are done
  // already. A ticket that waits for a ticket of this pipeline waits for a later pipeline.
  status.tickets = await readyTickets(repoDir);

  // ✋ Checkpoint 1: waits until `flows start` sends the tickets you approved. Unattended, all of them.
  let approved = status.tickets;
  if (!unattended) {
    status.step = 'waiting for your approval';
    await condition(() => decisions.approved !== undefined);
    approved = decisions.approved!;
  }

  // implement: one Ralph loop per ticket, each in its own worktree, all at the same time, all from the same
  // commit. A loop that fails doesn't stop the others: only the finished tickets go on to review. The loops
  // are named after the pipeline, pipeline-TICKET-5, so pipelines that run at the same time, in the evals, don't collide.
  status.step = 'implementing';
  const base = await headCommit(repoDir);
  const loops = approved.map((ticket) => {
    const workflowId = `${workflowInfo().workflowId}-${ticket}`;
    return executeChild(ralph, { workflowId, args: [{ repoDir, agent, ticket, base, unattended, acceptance }] });
  });
  const results = await Promise.allSettled(loops);
  const finished: string[] = [];
  results.forEach((result, i) => {
    const ticket = approved[i];
    add(status, result.status === 'fulfilled' ? result.value : usageOf(result.reason)); // a failed loop's runs cost too
    if (result.status === 'fulfilled' && result.value.done) finished.push(ticket);
    else if (result.status === 'fulfilled') status.unfinished.push(`${ticket}: out of runs, not done`);
    else status.unfinished.push(`${ticket}: ${failureMessage(result.reason)}`);
  });
  if (!finished.length) return finish(repoDir, status);

  // review: a fresh, read-only agent gets every finished branch's changes. Its verdict per branch is its last
  // line about it: `agent/ticket-5: APPROVE` or `agent/ticket-5: REJECT: <why>`. A rejected branch isn't merged.
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
  for (const ticket of finished) {
    const branch = branchOf(ticket);
    if (!status.approvedBranches.includes(branch)) continue;
    const why = await mergeBranch(repoDir, branch, into);
    if (why) {
      status.notMerged.push(`${branch}: ${why}`); // for example, it conflicts with a branch merged before it
    } else {
      status.merged.push(branch);
      await removeWorktree(repoDir, worktreeName(ticket), branch);
    }
  }
  return finish(repoDir, status);
}

// The tickets that never got to start, because what blocks them wasn't merged, and the tests of what was merged
async function finish(repoDir: string, status: PipelineStatus): Promise<PipelineStatus> {
  status.unfinished.push(...(await blockedTickets(repoDir, status.tickets)));
  if (status.merged.length) status.testsPass = (await runTests(repoDir)).pass;
  status.step = 'done';
  return status;
}
