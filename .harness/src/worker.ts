import { DefaultLogger, NativeConnection, Runtime, Worker } from '@temporalio/worker';
import * as activities from './activities';
import { TASK_QUEUE } from './shared';
import { noteWorkerVersion } from './version';

// The worker runs the workflows and activities. Stop it (Ctrl+C) and start it again at any time:
// the workflows continue where they were, Temporal keeps their state.
export async function runWorker(address: string, repoDir: string): Promise<void> {
  noteWorkerVersion(repoDir);
  // Short log lines: what the workflows log, prefixed with the workflow id, plus warnings and errors
  Runtime.install({
    logger: new DefaultLogger('INFO', ({ level, message, meta }) => {
      if (meta?.sdkComponent === 'workflow') {
        console.log(`[${meta.workflowId}] ${message}`);
      } else if (level === 'WARN' || level === 'ERROR') {
        console.error(`${level} ${message}${meta?.error ? `: ${meta.error}` : ''}`);
      }
    }),
  });
  const connection = await NativeConnection.connect({ address });
  const worker = await Worker.create({
    connection,
    taskQueue: TASK_QUEUE,
    workflowsPath: require.resolve('./workflows'),
    activities,
  });
  console.log(`Worker started, connected to ${address}. Agent output shows up here. Ctrl+C stops it.`);
  await worker.run();
}
