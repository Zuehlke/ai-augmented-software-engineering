// What the commands share: where Temporal is, the agent, your checkout, and how they start and follow workflows
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Client, WorkflowClient, WorkflowExecutionAlreadyStartedError, WorkflowFailedError, WorkflowHandle } from '@temporalio/client';
import type { Agent } from '../shared';
import { TASK_QUEUE } from '../shared';
import { failureMessage } from '../workflows/failure';
import { statusQuery } from '../workflows/signals';

export const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
const ui = process.env.TEMPORAL_UI ?? 'http://localhost:8233';
export const agent: Agent = process.env.AGENT === 'copilot' ? 'copilot' : 'claude';

// The root of the repository or worktree you are in
export function repoDir(): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

export function link(workflowId: string): string {
  return `${ui}/namespaces/default/workflows/${workflowId}`;
}

// One reader for all questions, so answers typed (or piped) ahead aren't lost
let reader: ReturnType<typeof createInterface> | undefined;
let answers: AsyncIterator<string> | undefined;
export async function ask(question: string): Promise<boolean> {
  reader ??= createInterface({ input: process.stdin });
  answers ??= reader[Symbol.asyncIterator]();
  process.stdout.write(`${question} [y/N] `);
  const answer = await answers.next();
  return !answer.done && answer.value.trim() === 'y';
}

// No more questions: the reader goes, so Ctrl+C stops the command again instead of going to the reader
export function noMoreQuestions(): void {
  reader?.close();
  reader = answers = undefined;
}

// Starts the workflow, or follows it if it's already running (for example after you pressed Ctrl+C)
export async function startOrFollow(client: Client, type: string, workflowId: string, input: object): Promise<WorkflowHandle> {
  try {
    const handle = await client.workflow.start(type, { taskQueue: TASK_QUEUE, workflowId, args: [input] });
    console.log(`Started ${workflowId}: ${link(workflowId)}`);
    return handle;
  } catch (err) {
    if (!(err instanceof WorkflowExecutionAlreadyStartedError)) throw err;
    console.log(`${workflowId} is already running, following it: ${link(workflowId)}`);
    return client.workflow.getHandle(workflowId);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Prints each judge's question once, from every running workflow, with the command to answer it.
// In the pipeline, the judges of the Ralph loops run in child workflows, so it looks at all of them.
const shown = new Set<string>();
export async function showQuestions(client: WorkflowClient): Promise<void> {
  for await (const { workflowId } of client.list({ query: 'ExecutionStatus = "Running"' })) {
    const question = await client.getHandle(workflowId).query(statusQuery).then((s) => s.question, () => undefined);
    if (question && !shown.has(`${workflowId} ${question}`)) {
      shown.add(`${workflowId} ${question}`);
      console.log(`\nThe judge in ${workflowId} asks: ${question}\nAnswer with: flows answer ${workflowId} "<your answer>"\n`);
    }
  }
}

// Waits for the workflow's result. Meanwhile prints the judges' questions.
export async function resultWithQuestions<T>(handle: WorkflowHandle): Promise<T> {
  const result: Promise<T> = handle.result();
  for (;;) {
    const finished = await Promise.race([result.then(() => true, () => true), sleep(3_000).then(() => false)]);
    if (finished) return result;
    await showQuestions(handle.client);
  }
}

// The reason a workflow failed, for example the judge's FAILED: <why>. Any other error, for example a lost
// connection to Temporal, says what went wrong itself.
export function workflowFailure(err: unknown): string {
  if (err instanceof WorkflowFailedError) return failureMessage(err);
  return err instanceof Error ? err.message : String(err);
}
