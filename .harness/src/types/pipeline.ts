// The phases and the workflows built from them: plan, the Ralph loop and the orchestration pipeline
import type { Agent, Usage } from '../shared';

// How many runs of a phase in a row the judge may reject before the phase is stuck and gives up
export const MAX_FAILURES = 3;

// The most runs a Ralph loop takes, a backstop: `--runs` or one run in `flows watch` lowers it
export const MAX_RUNS = 30;

// A phase: an agent does the work with the skill of the same name, .agents/skills/<name>/SKILL.md, and a
// separate judge checks it with the judge skill. The research role's phase is research, the plan role's
// plan, the implement role's implement.
export type PhaseName = 'research' | 'plan' | 'implement';

export interface Phase {
  name: PhaseName;
  input: string; // what the agent works on, for example the ticket. The judge gets it too.
  // How many agent runs at most. Every run counts, also one that passes but leaves more to do (Ralph's steps).
  // A backstop against a loop that never ends: MAX_FAILURES rejections in a row stop a stuck one sooner.
  maxRuns: number;
  // Plain code that checks the work before the judge agent does, and never guesses. Returns what's
  // broken, or null. Ralph runs the tests here: if they fail, there's no need to ask the judge.
  check?: () => Promise<string | null>;
  done?: () => Promise<boolean>; // more to do after a PASS? Ralph's ticket takes several steps.
  // Nobody answers the judge's questions: the agent gets the question, and makes an assumption
  unattended?: boolean;
}

// What the judge says about the agent's last run
export interface Verdict {
  kind: 'PASS' | 'RETRYABLE' | 'AMBIGUOUS' | 'FAILED';
  reason: string;
}

// What `flows status` shows about a phase. `question` is set while the judge waits for your answer.
export interface PhaseStatus extends Usage {
  run?: number; // the agent run the phase is at: 1, 2, …
  question?: string;
  judging?: boolean; // the judge is checking the agent's last run
}

export interface PlanInput {
  repoDir: string;
  agent: Agent;
  request?: string; // a feature request, or
  spec?: string; // a specification in specs/, as the plan agent gets it in the pipeline
}

export interface PlanStatus extends Usage {
  step: 'planning' | 'done';
  newTickets: string[];
}

export interface RalphInput {
  repoDir: string; // your checkout. The loop works in a worktree of its own.
  agent: Agent;
  ticket: string;
  maxRuns?: number;
  // The commit the pipeline starts all its loops from. Without it (`flows ralph`), the loop starts from your
  // branch, or goes on with agent/<ticket> if an earlier run left it.
  base?: string;
  unattended?: boolean; // the judge's questions go back to the agent, nobody answers them
  acceptance?: Acceptance; // the evals run's acceptance feedback, off by default
}

// The evals' hidden acceptance tests of a task, which a loop can run on a finished ticket: it only learns the
// names of the ones that fail. `repoDir` is the checkout the evals runs from, where the tests are.
export interface Acceptance {
  repoDir: string;
  task: string;
}

export interface RalphStatus extends PhaseStatus {
  ticket: string;
}

// What a Ralph loop returns: whether its ticket is done, and what its runs cost
export interface RalphResult extends Usage {
  done: boolean;
}

export interface PipelineInput {
  repoDir: string;
  agent: Agent;
  // The feature request, as you typed it after `flows start`
  request: string;
  // Nobody watches, for example in the evals: it implements every ready ticket, merges what the review
  // approved, and the judges' questions go back to the agents instead of waiting for an answer
  unattended?: boolean;
  acceptance?: Acceptance;
}

export type PipelineStep =
  | 'researching'
  | 'planning'
  | 'waiting for your approval'
  | 'implementing'
  | 'reviewing'
  | 'waiting for your merge decision'
  | 'merging'
  | 'done';

export interface PipelineStatus extends PhaseStatus {
  step: PipelineStep;
  into?: string; // the branch you started it on, where it merges to
  // The tickets marked `ready`, waiting for your approval
  tickets: string[];
  unfinished: string[]; // the approved tickets whose loop failed or ran out of runs, with why: `TICKET-6: <why>`
  review: string; // what the review agent says about the finished branches
  approvedBranches: string[];
  // Why it didn't merge when you said yes, for example uncommitted changes. It waits for your decision again.
  mergeProblem?: string;
  merged: string[];
  notMerged: string[]; // the approved branches it couldn't merge, with why: `agent/ticket-6: <why>`
  testsPass?: boolean;
}

// A ticket in backlog/: the file backlog/<id>-<slug>.md
export interface Ticket {
  id: string; // TICKET-5
  title: string; // its first heading
  status: string; // the `status:` in its file, for example ready, blocked or done
  blockedBy: string[]; // the tickets in its `blocked_by:`, the ones it waits for
  blockedReason?: string; // its `blocked_reason:`, something outside the repo it waits for
}

// What the agent's last run changed, for the judge's rules and the judge
export interface Changes {
  files: string[]; // the files its commits changed
  uncommitted: string[]; // the files it changed without committing them
  commits: string; // its commits with their diffs, cut if they're very long
}

export interface TestResult {
  pass: boolean;
  // The end of the output, enough to see what failed
  tail: string;
}
