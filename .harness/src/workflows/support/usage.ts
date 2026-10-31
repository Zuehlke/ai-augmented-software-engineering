// Adds up what a workflow's agent runs cost, and which models they ran with (no I/O, so it's deterministic)
import { ApplicationFailure, ChildWorkflowFailure, isCancellation } from '@temporalio/workflow';
import type { Role, Usage } from '../../config';
import type { AgentRun } from '../../types/agent';
import { failureMessage } from './failure';

// A cost added to a sum: no sum yet counts as 0. Once one cost is unknown (null, or not reported), the sum is too.
export function addCost(sum: number | null | undefined, cost: number | null | undefined): number | null {
  return sum === null || cost === null || cost === undefined ? null : (sum ?? 0) + cost;
}

// Counts one agent run of a role, and returns its answer
export function count(usage: Usage, role: Role, run: AgentRun): string {
  usage.costUsd = addCost(usage.costUsd, run.costUsd);
  if (run.model) usage.models = { ...usage.models, [role]: run.model };
  if (run.costUsd !== undefined) addRoleCost(usage, role, run.costUsd);
  return run.output;
}

function addRoleCost(usage: Usage, role: Role, cost: number): void {
  usage.costByRole = { ...usage.costByRole, [role]: (usage.costByRole?.[role] ?? 0) + cost };
}

// Counts a run that a judge, or the plain-code checks before it, rejected, and why
export function rejected(usage: Usage, why: string): void {
  usage.rejections = (usage.rejections ?? 0) + 1;
  usage.rejectedBecause = [...(usage.rejectedBecause ?? []), why];
}

// Adds what another workflow's runs cost, for example a pipeline's Ralph loop
export function add(usage: Usage, other: Usage | undefined): void {
  if (other?.costUsd === undefined) return;
  usage.costUsd = addCost(usage.costUsd, other.costUsd);
  usage.models = { ...usage.models, ...other.models };
  for (const [role, cost] of Object.entries(other.costByRole ?? {}) as [Role, number][]) addRoleCost(usage, role, cost);
  if (other.rejections) usage.rejections = (usage.rejections ?? 0) + other.rejections;
  if (other.rejectedBecause?.length) usage.rejectedBecause = [...(usage.rejectedBecause ?? []), ...other.rejectedBecause];
}

// Only the usage fields of a status, for example a Ralph loop's: what it returns, or keeps in a failure
export function usageOnly({ costUsd, costByRole, rejections, rejectedBecause, models }: Usage): Usage {
  return { costUsd, costByRole, rejections, rejectedBecause, models };
}

// Runs a workflow's work. If it fails, the failure keeps what the runs cost so far, so a parent that
// counts its children's cost, the pipeline or the evals, still counts it. A cancel stays a cancel.
export async function keepingUsage<T>(usage: Usage, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (isCancellation(err)) throw err;
    // A failure of its own keeps its message, one of an activity or a child workflow gets its cause's
    const message = err instanceof ApplicationFailure ? err.message : failureMessage(err);
    const type = err instanceof ApplicationFailure ? (err.type ?? undefined) : undefined;
    // What the runs cost goes with the failure, as its details: usageOf reads it back
    throw ApplicationFailure.create({ message, type, nonRetryable: true, details: [usageOnly(usage)] });
  }
}

// What a failed child workflow's runs cost, from its failure (see keepingUsage)
export function usageOf(err: unknown): Usage | undefined {
  const cause = err instanceof ChildWorkflowFailure ? err.cause : err;
  return cause instanceof ApplicationFailure ? (cause.details?.[0] as Usage | undefined) : undefined;
}
