// The orchestration pipeline's two checkpoints: `flows start` approves the tickets, `flows merge` decides the merge
import { Client, WorkflowHandle } from '@temporalio/client';
import type { PipelineStatus } from '../types/pipeline';
import { approveTicketsSignal, decideMergeSignal, pipelineStatus } from '../workflows/signals';
import { agent, ask, repoDir, showQuestions, sleep, startOrFollow } from './common';

export async function start(client: Client, request: string | undefined): Promise<number> {
  if (!request) {
    console.error('Usage: flows start "<feature request>"');
    return 1;
  }
  const handle = await startOrFollow(client, 'pipeline', 'pipeline', { repoDir: repoDir(), agent, request });
  console.log('Waiting for the research and the plan agent. Their output shows up in the worker.');
  const status = await waitFor(handle, (s) => !['researching', 'planning'].includes(s.step));
  if (status.step !== 'waiting for your approval') {
    console.log(`The pipeline is already past planning, it's ${status.step}.`);
    return 0;
  }
  console.log('Read the specification in specs/ and the new tickets in backlog/ before you answer.');

  // Checkpoint 1: only the tickets you approve get an implement loop
  const approved: string[] = [];
  for (const id of status.tickets) {
    if (await ask(`Hand ${id} to an unattended agent?`)) approved.push(id);
  }
  await handle.signal(approveTicketsSignal, approved);
  console.log(`Approved: ${approved.join(' ') || 'none'}`);
  console.log('The pipeline goes on by itself: the implement loops, then the review agent. Next, run `flows merge`.');
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
