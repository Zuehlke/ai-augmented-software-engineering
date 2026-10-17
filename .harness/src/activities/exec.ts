import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Context } from '@temporalio/activity';
import { ApplicationFailure } from '@temporalio/common';

const MAX_OUTPUT = 200_000;

// Which workflow an activity belongs to: what the worker's log puts in front of its lines
export function label(): string {
  const { info } = Context.current();
  return info.workflowExecution?.workflowId ?? info.activityType;
}

// Runs a command inside an activity. While it runs, the activity heartbeats, so Temporal notices
// within a minute when the worker dies. When Temporal cancels the activity, the command is killed.
// `show` turns an output line into what the worker's log shows of it, or nothing.
export async function exec(
  cwd: string,
  command: string,
  args: string[],
  { quiet = false, show = (line: string): string | undefined => line } = {},
): Promise<{ code: number; output: string }> {
  const context = Context.current();
  // A process group of its own, so a cancel also stops what the command started (mvn, git, ...)
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const kill = () => child.pid && process.kill(-child.pid, 'SIGTERM');
  context.cancellationSignal.addEventListener('abort', kill);

  let output = '';
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', (line) => {
      output = (output + line + '\n').slice(-MAX_OUTPUT);
      if (quiet) return;
      for (const shown of show(line)?.split('\n') ?? []) console.log(`[${label()}] ${shown}`);
    });
  }

  const heartbeat = setInterval(() => context.heartbeat(), 10_000);
  try {
    const code = await new Promise<number>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code) => (context.cancellationSignal.aborted ? reject(context.cancellationSignal.reason) : resolve(code ?? 1)));
    });
    return { code, output };
  } finally {
    clearInterval(heartbeat);
    context.cancellationSignal.removeEventListener('abort', kill);
  }
}

// git <args>, fails the activity if git fails
export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { code, output } = await exec(cwd, 'git', args, { quiet: true });
  if (code !== 0) {
    throw ApplicationFailure.retryable(`git ${args.join(' ')} failed:\n${output}`);
  }
  return output;
}
