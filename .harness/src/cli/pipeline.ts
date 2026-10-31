// The orchestration pipeline's checkpoints: `flows start` approves the specification and the plan, or sends them back
// (also `flows approve`, `flows revise`), `flows merge` decides the merge
import { Client, WorkflowHandle } from '@temporalio/client';
import type { Checkpoint, PipelineStatus } from '../types/pipeline';
import { approveSpecificationSignal, approveTasksSignal, decideMergeSignal, pipelineStatus, reviseSignal } from '../workflows/signals';
import { agent, ask, askText, repoDir, showQuestions, sleep, startOrFollow } from './common';

export async function start(client: Client, request: string | undefined): Promise<number> {
  if (!request) {
    console.error('Usage: flows start "<feature request>"');
    return 1;
  }
  const handle = await startOrFollow(client, 'pipeline', 'pipeline', { repoDir: repoDir(), agent, request });
  for (;;) {
    console.log('Waiting for the agents. Their output shows up in the worker.');
    const status = await waitFor(handle, (s) => !['researching', 'designing', 'planning'].includes(s.step));
    if (status.mergeProblem) {
      console.log(`It couldn't bring what it wrote onto ${status.into}: ${status.mergeProblem}. Then run flows start again.`);
      return 1;
    }

    // Checkpoint 1: the specification
    if (status.step === 'waiting for your specification approval') {
      console.log('Read the specification in specs/ before you answer.');
      if (!(await decide(handle, 'specification', 'Approve the specification?'))) return 0;
      await waitFor(handle, (s) => s.step !== status.step); // until it took your decision
      continue;
    }
    if (status.step !== 'waiting for your plan approval') {
      console.log(`The pipeline is already past planning, it's ${status.step}.`);
      return 0;
    }

    // Checkpoint 2: the plan, the design and its tasks. Only the tasks you approve get an implement loop.
    console.log('Read the design next to the specification and the new tasks in backlog/ before you answer.');
    if (!(await ask('Approve the plan?'))) {
      if (!(await sendBack(handle, 'plan'))) return 0;
      await waitFor(handle, (s) => s.step !== status.step);
      continue;
    }
    const approved: string[] = [];
    for (const id of status.tasks) {
      if (await ask(`Hand ${id} to an unattended agent?`)) approved.push(id);
    }
    await handle.signal(approveTasksSignal, approved);
    console.log(`Approved: ${approved.join(' ') || 'none'}`);
    console.log('The pipeline goes on by itself: the implement loops, then the review agent. Next, run `flows merge`.');
    return 0;
  }
}

// Asks you at the specification's checkpoint: approve, or send it back with feedback. False when you decide later.
async function decide(handle: WorkflowHandle, on: Checkpoint, question: string): Promise<boolean> {
  if (await ask(question)) {
    await handle.signal(approveSpecificationSignal);
    console.log('Approved. The design agent goes on.');
    return true;
  }
  return sendBack(handle, on);
}

// Sends a checkpoint back with your feedback. False when you give none: you decide later.
async function sendBack(handle: WorkflowHandle, on: Checkpoint): Promise<boolean> {
  const feedback = await askText(`Your feedback, for the ${on === 'specification' ? 'research agent' : 'design and the plan agent'} (empty: decide later):`);
  if (!feedback) {
    console.log(`Decide later with flows approve ${on} or flows revise ${on} "<feedback>".`);
    return false;
  }
  await handle.signal(reviseSignal, on, feedback);
  console.log(`Sent back. ${on === 'specification' ? 'The research agent revises the specification' : 'Its tasks go, the design agent revises the design, and the plan agent cuts the tasks again'}.`);
  return true;
}

// `flows approve specification|plan`: approves what waits for you. The plan with all its ready tasks.
export async function approve(client: Client, on: string | undefined): Promise<number> {
  if (on !== 'specification' && on !== 'plan') {
    console.error('Usage: flows approve specification|plan');
    return 1;
  }
  const handle = client.workflow.getHandle('pipeline');
  const status = await handle.query(pipelineStatus);
  if (status.step !== `waiting for your ${on} approval`) {
    console.error(`The pipeline doesn't wait for your ${on} approval, it's ${status.step}.`);
    return 1;
  }
  if (on === 'specification') await handle.signal(approveSpecificationSignal);
  else await handle.signal(approveTasksSignal, status.tasks);
  console.log(on === 'specification' ? 'Approved. The design agent goes on.' : `Approved, with ${status.tasks.join(' ') || 'no tasks'}.`);
  return 0;
}

// `flows revise specification|plan "<feedback>"`: sends it back to the agents with your feedback
export async function revise(client: Client, on: string | undefined, feedback: string | undefined): Promise<number> {
  if ((on !== 'specification' && on !== 'plan') || !feedback?.trim()) {
    console.error('Usage: flows revise specification|plan "<feedback>"');
    return 1;
  }
  const handle = client.workflow.getHandle('pipeline');
  const status = await handle.query(pipelineStatus);
  if (status.step !== `waiting for your ${on} approval`) {
    console.error(`The pipeline doesn't wait for your ${on} approval, it's ${status.step}.`);
    return 1;
  }
  await handle.signal(reviseSignal, on, feedback.trim());
  console.log(on === 'specification'
    ? 'Sent back. The research agent revises the specification with your feedback.'
    : 'Sent back. Its tasks go, the design agent revises the design with your feedback, and the plan agent cuts the tasks again.');
  return 0;
}

export async function merge(client: Client): Promise<number> {
  const handle = client.workflow.getHandle('pipeline');
  console.log('Waiting for the implement loops and the review agent. Their output shows up in the worker.');
  console.log('Ctrl+C here only stops waiting, the pipeline goes on.');
  const status = await waitFor(handle, (s) => ['waiting for your merge decision', 'merging', 'done'].includes(s.step));
  if (status.step !== 'waiting for your merge decision') {
    console.log(`The pipeline isn't waiting for a merge decision anymore, it's ${status.step}.`);
    return 1;
  }
  for (const line of status.unfinished) console.log(`Not finished, not reviewed: ${line}`);
  console.log(status.review);

  // Checkpoint 2
  const yes = await ask(`Merge ${status.approvedBranches.join(' ') || 'nothing'} into ${status.into}, rebased and fast-forwarded?`);
  await handle.signal(decideMergeSignal, yes);
  if (!yes) {
    console.log('Not merged.');
    return 0;
  }
  // Your checkout may not be ready for the merge, for example with uncommitted changes. Then it waits for you again.
  const after = await waitFor(handle, (s) => s.step !== 'waiting for your merge decision' || !!s.mergeProblem);
  if (after.mergeProblem) {
    console.log(`Not merged yet: ${after.mergeProblem}. Then run flows merge again.`);
    return 1;
  }
  const result: PipelineStatus = await handle.result();
  console.log(`Merged: ${result.merged.join(' ') || 'none'}`);
  for (const line of result.notMerged) console.log(`Not merged: ${line}`);
  for (const line of result.unfinished) console.log(`Not finished: ${line}`);
  if (result.testsPass === undefined) return 0; // nothing merged, nothing to test
  console.log(`Tests after the merge: ${result.testsPass ? 'pass' : 'FAIL'}`);
  return result.testsPass ? 0 : 1;
}

// Asks the pipeline for its status until `done` says it's far enough
// Meanwhile prints the judges' questions.
async function waitFor(handle: WorkflowHandle, done: (status: PipelineStatus) => boolean): Promise<PipelineStatus> {
  for (;;) {
    const status = await handle.query(pipelineStatus);
    if (done(status)) return status;
    await showQuestions(handle.client);
    await sleep(3_000);
  }
}
