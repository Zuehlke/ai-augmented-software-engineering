import type { AgentInput, AgentRun } from '../src/types/agent';

// A fake runAgent from one that only answers: no cost, no model, as Copilot reports it
export function answers(answer: (input: AgentInput) => string | Promise<string>): (input: AgentInput) => Promise<AgentRun> {
  return async (input) => ({ output: await answer(input) });
}
