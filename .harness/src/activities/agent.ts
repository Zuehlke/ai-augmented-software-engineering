import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Context } from '@temporalio/activity';
import { ApplicationFailure } from '@temporalio/common';
import { AGENT_MODELS } from '../config';
import type { AgentInput, AgentRun } from '../types/agent';
import type { SkillLoad } from '../types/skill-loaded-evals';
import { exec, git, label } from './exec';

// One headless agent run with a fresh context, inside the sandbox. It works in workDir, a worktree. The
// sandbox profile comes from your checkout (repoDir), so the agent can't loosen it for its next run.
// claude answers in stream-json, one event per line: its answer, what it cost and its model are in there.
export async function runAgent({ repoDir, workDir = repoDir, agent, mode, model, prompt, step }: AgentInput): Promise<AgentRun> {
  if (mode === 'write' && Context.current().info.attempt > 1) {
    // This is a retry: the attempt before was interrupted halfway (worker stopped, agent crashed).
    // Throw away its uncommitted changes, so every attempt starts from the last commit.
    await git(workDir, 'reset', '--hard', 'HEAD');
    await git(workDir, 'clean', '-fd');
  }

  const sandbox = await readFile(path.join(repoDir, '.harness/sandbox/no-network.json'), 'utf8');
  const modelArgs = model ? ['--model', AGENT_MODELS[agent][model]] : [];
  const stream = ['--output-format', 'stream-json', '--verbose'];
  const commands: Record<string, [string, string[]]> = {
    'claude-write': ['claude', ['-p', prompt, ...modelArgs, ...stream, '--dangerously-skip-permissions', '--settings', sandbox]],
    'claude-read': ['claude', ['-p', prompt, ...modelArgs, ...stream, '--tools', 'Read,Grep,Glob', '--strict-mcp-config', '--settings', sandbox]],
    'copilot-write': ['copilot', ['--experimental', '--sandbox', '--autopilot', '--yolo', ...modelArgs, '-p', prompt]],
    'copilot-read': ['copilot', ['--experimental', '--sandbox', '--allow-all-tools', '--deny-tool=shell', '--deny-tool=write', '--disable-builtin-mcps', ...modelArgs, '-p', prompt]],
  };
  const [command, args] = commands[`${agent}-${mode}`];
  console.log(`[${label()}] == ${step ?? 'agent'}: ${command}`);

  const { code, output } = await exec(workDir, command, args, agent === 'claude' ? { show: readable } : {});
  if (code !== 0) {
    // Retryable: Temporal runs the agent again, as configured in the workflow's retry policy
    throw ApplicationFailure.retryable(`${command} exited with code ${code}`);
  }
  if (agent === 'copilot') return { output: output.slice(-20_000) };
  const run = parseStream(output);
  if (!run) throw ApplicationFailure.retryable('claude stopped without a result');
  return { ...run, output: run.output.slice(-20_000) };
}

function events(output: string): Record<string, any>[] {
  return output.split('\n').flatMap((line) => {
    if (!line.startsWith('{')) return [];
    try {
      return [JSON.parse(line)];
    } catch {
      return []; // a line cut off at the start of the kept output
    }
  });
}

// The answer, the cost and the model from claude's stream-json output, or undefined without a result event.
// The model is in the init event, at the very start. If a long run's output lost it, the result's
// modelUsage names every model the run used: the one that cost the most is the role's.
export function parseStream(output: string): AgentRun | undefined {
  const all = events(output);
  const result = [...all].reverse().find((e) => e.type === 'result');
  if (!result) return undefined;
  const init = all.find((e) => e.type === 'system' && e.subtype === 'init');
  // Every model the run used, the one that cost the most first
  const modelUsage = (result.modelUsage ?? {}) as Record<string, { costUSD?: number }>;
  const usage = Object.entries(modelUsage).sort(([, a], [, b]) => (b.costUSD ?? 0) - (a.costUSD ?? 0));
  return {
    output: typeof result.result === 'string' ? result.result : '',
    costUsd: typeof result.total_cost_usd === 'number' ? result.total_cost_usd : undefined,
    model: init?.model ?? usage[0]?.[0],
  };
}

// What the worker's log shows of a stream-json line: the agent's text, and the tools it calls
export function readable(line: string): string | undefined {
  const [event] = events(line);
  if (!event) return line.trim() ? line : undefined;
  if (event.type === 'assistant') {
    const parts = (event.message?.content ?? []).map((block: Record<string, any>) => {
      if (block.type === 'text') return block.text;
      if (block.type !== 'tool_use') return '';
      const input = block.input ?? {};
      const what = input.file_path ?? input.command ?? input.pattern ?? input.skill ?? '';
      return `→ ${block.name} ${String(what).split('\n')[0].slice(0, 120)}`.trimEnd();
    });
    return parts.filter(Boolean).join('\n') || undefined;
  }
  if (event.type === 'result' && typeof event.total_cost_usd === 'number') return `== ${event.num_turns ?? '?'} turns, $${event.total_cost_usd.toFixed(2)}`;
  return undefined;
}

// One short, read-only agent run: does Claude Code load the skill for this prompt? It only needs its
// first few turns to decide, so it stops after ten. It always runs claude, also with AGENT=copilot: its
// stream-json output shows the tool calls that load a skill.
export async function loadsSkill(repoDir: string, skill: string, prompt: string): Promise<SkillLoad> {
  const sandbox = await readFile(path.join(repoDir, '.harness/sandbox/no-network.json'), 'utf8');
  const { output } = await exec(repoDir, 'claude', [
    '-p', prompt,
    '--tools', 'Read,Grep,Glob,Skill',
    '--max-turns', '10',
    '--output-format', 'stream-json', '--verbose', // one JSON event per line, tool calls included
    '--strict-mcp-config', '--settings', sandbox,
  ], { quiet: true });
  // The exit code is 1 when the agent used up its turns, so look for the final result event instead
  const run = parseStream(output);
  if (!run) throw ApplicationFailure.retryable('claude stopped without a result');

  const toolCalls = events(output)
    .flatMap((event) => event.message?.content ?? [])
    .filter((block) => block.type === 'tool_use');

  // The agent loads a skill through the Skill tool, or by reading its SKILL.md
  const loaded = toolCalls.some(({ name, input }) =>
    (name === 'Skill' && input.skill === skill) ||
    (name === 'Read' && input.file_path?.endsWith(`skills/${skill}/SKILL.md`)));
  return { loaded, costUsd: run.costUsd, model: run.model };
}
