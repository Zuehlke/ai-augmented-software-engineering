// The evals: every task runs through the unattended pipeline, and is graded
import type { Agent, Role, Usage } from '../shared';
import type { PipelineStep } from './pipeline';

// The evals grades the setup as it is, the skills, the harness and the models, on a few fixed tasks. Each
// task is a folder .harness/evals/tasks/<id>/: request.md, the feature request; base, the commit its app
// code starts from; accept/, the hidden acceptance tests, laid out like the repository.
export interface EvalsTask {
  id: string;
  request: string;
  base: string;
}

export interface EvalsInput {
  repoDir: string; // your checkout: the evals copies it, and writes its results to .harness/evals/results/
  agent: Agent;
  evalsId: string; // for example 20261016-174500, the folder of its results
  tasks: EvalsTask[];
  runs?: number; // per task, 3 by default
  parallel?: number; // how many runs work at the same time, 3 by default
  // The loops learn which hidden acceptance tests fail when they think a ticket is done, by name only.
  // Off by default: the evals then grades what the agents do without that help.
  acceptanceFeedback?: boolean;
}

// What the evals ran: the commits of the setup, as they are in your checkout
export interface Setup {
  commit: string;
  skillsCommit: string; // the last commit that changed .agents/skills
  harnessCommit: string; // the last commit that changed the harness's code, HARNESS_CODE
}

// One run of a task, as the evals stores it in .harness/evals/results/<evalsId>/<task>-<run>.json
export interface EvalsRun extends Usage {
  task: string;
  run: number;
  accepted: boolean;
  reason: string; // why it was or wasn't accepted
  grading?: string; // the grader's answer, its reasoning before the verdict
  review?: string; // what the pipeline's review agent said about the branches, whole
  durationS: number;
  step: PipelineStep | 'failed'; // how far its pipeline got
  merged: string[];
  skillsCommit: string;
  harnessCommit: string;
}

// A whole evals, as it stores it in .harness/evals/results/<evalsId>/evals.json
export interface EvalsReport extends Setup {
  evalsId: string;
  startedAt: string;
  tasks: string[];
  runs: EvalsRun[];
  models: Partial<Record<Role, string>>; // every model a run ran with, per role
  quality: { accepted: number; of: number }; // accepted runs, of all runs
  reliability: { tasks: number; of: number }; // tasks whose runs were all accepted, of all tasks
  costUsd: number | null; // all runs together
  costByRole?: Partial<Record<Role, number>>; // the same, per role
  costPerAccepted: number | null | undefined; // undefined when no run was accepted
  // Accepted runs in which no judge and no plain-code check rejected a step, of all runs: the setup got it right the first time
  firstTimeRight?: { runs: number; of: number };
  acceptanceFeedback?: boolean; // the loops learned which hidden tests fail: runs of such an evals run aren't comparable with the others
  // What the improve agent proposes to change in the setup, as markdown, when runs weren't right the first time. The
  // pipeline can't change the skills and the harness: you make the changes you agree with, and the next evals
  // shows whether they helped.
  proposals?: string;
}

// What `flows status` and `flows watch` show of a running evals
export interface EvalsStatus extends Usage {
  evalsId: string;
  proposing?: boolean; // the runs are done, the improve agent writes its proposals
  runs: { task: string; run: number; state: 'waiting' | 'running' | 'grading' | 'done'; accepted?: boolean; costUsd?: number | null }[]; // costUsd once it's done
}
