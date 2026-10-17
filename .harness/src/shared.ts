// What every part shares: the workflows, the activities, the worker, the CLI and `flows watch`. The types of
// each feature are next to it in types/: pipeline.ts (the phases, Ralph, plan and the pipeline), evals.ts and
// skill-loaded-evals.ts, and agent.ts for one agent run.
// Workflows run in Temporal's deterministic sandbox, so this file and types/ must not import any Node module.
//
// The words used throughout:
// - role: who does the work. The agents research, plan, implement (the Ralph loop), review, and judge; dispatch
//   and merge are plain code.
// - phase: one role's agent doing the work, checked by a judge, in runs until it passes. research, plan, implement.
// - step: where a workflow is, in its `status`. The pipeline goes researching → planning → … → done.
// - run: one agent run, with a fresh context. (Attempts are Temporal's: it retries an activity that failed.)

export const TASK_QUEUE = 'flows';

// The harness's own code, the `flows` command, in .harness/. The rest of .harness/ is what it works with: the
// sandbox profile, the evals tasks, and what the agents leave there while they run (progress.md, learnings.md,
// run/, worktrees/). The paths are relative to the repository.
export const HARNESS_CODE = ['.harness/src/', '.harness/test/', '.harness/bin/', '.harness/package.json', '.harness/package-lock.json', '.harness/tsconfig.json'];

// A ticket's Ralph loop works in .harness/worktrees/<name>, on the branch agent/<name>. For TICKET-5: ticket-5
export function worktreeName(ticket: string): string {
  return ticket.toLowerCase();
}

export function branchOf(ticket: string): string {
  return `agent/${worktreeName(ticket)}`;
}

export type Agent = 'claude' | 'copilot';

// The model family of a role, as the alias `claude --model` takes: it always resolves to the latest version.
// The roles that run once and shape everything after them get the strongest family, the Ralph loop that runs
// most often gets the cheaper one. The judge is at least as strong as the agent it checks.
export type Model = 'opus' | 'sonnet' | 'haiku';

export const MODELS = {
  research: 'opus',
  plan: 'opus',
  implement: 'sonnet',
  judge: 'opus',
  review: 'opus',
  // The evals' grader decides whether a run would ship: at least as strong as the implement role it grades
  grader: 'opus',
  // Reads why the evals' runs were rejected and proposes changes to the setup, for you to make
  improve: 'opus',
} as const satisfies Record<string, Model>;

export type Role = keyof typeof MODELS;

// What a workflow's agent runs cost so far, and the model each role really ran with. costUsd is unset
// before the first run, and null once a run didn't report its cost: then the sum is unknown.
export interface Usage {
  costUsd?: number | null;
  costByRole?: Partial<Record<Role, number>>; // the same cost per role, from the runs that reported it
  rejections?: number; // the runs a judge, or the plain-code checks before it, rejected: the work wasn't right the first time
  rejectedBecause?: string[]; // why, one per rejected run, with its phase in front: `implement: the tests fail …`
  models?: Partial<Record<Role, string>>;
}

// A cost as `flows status` and `flows watch` show it: $0.42, or unknown
export function dollars(costUsd: number | null | undefined): string {
  return costUsd === null ? 'unknown' : `$${(costUsd ?? 0).toFixed(2)}`;
}
