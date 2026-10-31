// Any running workflow: what it's doing, and your answer to its judge's question
import { Client } from '@temporalio/client';
import { dollars } from '../config';
import { answerSignal, statusQuery } from '../workflows/signals';
import { link } from './common';

export async function status(client: Client, workflowId: string | undefined): Promise<number> {
  const ids: string[] = [];
  if (workflowId) {
    ids.push(workflowId);
  } else {
    for await (const workflow of client.workflow.list({ query: 'ExecutionStatus = "Running"' })) {
      ids.push(workflow.workflowId);
    }
    if (ids.length === 0) console.log('No workflow is running.');
  }
  for (const id of ids) {
    console.log(`== ${id} (${link(id)})`);
    const status = await client.workflow.getHandle(id).query(statusQuery);
    console.log(`Cost so far: ${dollars(status.costUsd)}`);
    for (const [role, model] of Object.entries(status.models ?? {})) console.log(`  ${role.padEnd(10)} ${model}`);
    console.log(JSON.stringify(status, null, 2));
  }
  return 0;
}

export async function answer(client: Client, workflowId: string | undefined, text: string | undefined): Promise<number> {
  if (!workflowId || !text) {
    console.error('Usage: flows answer <workflow> "<answer>"');
    return 1;
  }
  await client.workflow.getHandle(workflowId).signal(answerSignal, text);
  console.log('Sent. The next run gets your answer.');
  return 0;
}
