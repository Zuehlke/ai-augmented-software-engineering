// What every part shares: the workflows, the activities, the worker, the CLI and `flows watch`: the task queue,
// the model per role, the branch names, the limits of the runs. The types are in types/.
// Workflows run in Temporal's deterministic sandbox, so this file, types/ and workflows/ must not import any
// Node module. What needs Node is in activities/ (run by the worker) or lib/ (anyone may use it).
//
// The words used throughout:
// - role: who does the work. The agents research, design, plan, implement (the Ralph loop), review, and judge;
//   dispatch and merge are plain code.
// - phase: one role's agent doing the work, checked by a judge, in runs until it passes. research, design, plan,
//   implement.
// - step: where a workflow is, in its `status`. The pipeline goes researching → planning → … → done.
// - run: one agent run, with a fresh context. (Attempts are Temporal's: it retries an activity that failed.)

export const TASK_QUEUE = 'flows';

// The harness's own code, the `flows` command, in .harness/. The rest of .harness/ is what it works with: the
// sandbox profile, the evals tasks, and what the agents leave there while they run (progress.md, learnings.md,
// run/, worktrees/). The paths are relative to the repository.
export const HARNESS_CODE = ['.harness/src/', '.harness/test/', '.harness/bin/', '.harness/package.json', '.harness/package-lock.json', '.harness/tsconfig.json'];

// A task's Ralph loop works in .harness/worktrees/<name>, on the branch agent/<name>. For TASK-5: task-5
export function worktreeName(task: string): string {
  return task.toLowerCase();
}

export function branchOf(task: string): string {
  return `agent/${worktreeName(task)}`;
}

export type Agent = 'claude' | 'copilot';

// The model family of a role, as the alias `claude --model` takes: it always resolves to the latest version.
// The roles that run once and shape everything after them get the strongest family, the Ralph loop that runs
// most often gets the cheaper one. The judge is at least as strong as the agent it checks.
export type Model = 'opus' | 'sonnet' | 'haiku';

// What each agent runs for a family, the one place to change it. claude takes the family as an alias. Copilot takes
// its own ids and doesn't offer Opus or Haiku to every account: the strongest family gets GPT-6.1 Sol, the others
// Sonnet 5.5, Copilot's default. flows watch shows these too.
export const AGENT_MODELS: Record<Agent, Record<Model, string>> = {
  claude: { opus: 'opus', sonnet: 'sonnet', haiku: 'haiku' },
  copilot: { opus: 'gpt-6.1-sol', sonnet: 'claude-sonnet-5.5', haiku: 'claude-sonnet-5.5' },
};

export const MODELS = {
  research: 'opus',
  design: 'opus',
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

// The limits of the agents' runs
// How many runs of a phase in a row the judge may reject before the phase is stuck and gives up
export const MAX_FAILURES = 3;

// The most runs a Ralph loop takes, a backstop: `--runs` or one run in `flows watch` lowers it
export const MAX_RUNS = 30;

// How often each evals task runs: 3 runs, so a task can be reliable or not
export const EVAL_RUNS = 3;
