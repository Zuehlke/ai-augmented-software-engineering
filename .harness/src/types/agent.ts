// One agent run: what the workflows ask for, and what the runAgent activity gives back
import type { Agent, Model } from '../config';

// write: the agent can change files and commit. read: the agent can only read files.
export type Mode = 'write' | 'read';

export interface AgentInput {
  repoDir: string; // your checkout: the sandbox profile comes from its .harness/
  workDir?: string; // where the agent works, a worktree. Without it, in repoDir.
  agent: Agent;
  mode: Mode;
  model?: Model; // without it, the agent's default
  prompt: string;
  step?: string; // what the run is for, in the worker's log, for example `implement` or `judge research`
}

// What one agent run gives back: its answer, what it cost, and the model the family resolved to.
// Copilot reports neither cost nor model.
export interface AgentRun {
  output: string;
  costUsd?: number;
  model?: string; // for example claude-opus-5-5, where the role asked for `opus`
}
