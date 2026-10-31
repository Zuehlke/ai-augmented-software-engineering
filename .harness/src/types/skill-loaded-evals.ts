// The skill-loaded evals: does the agent load each skill when it should?
import type { Agent } from '../config';

export interface SkillLoadedEvalInput {
  repoDir: string;
  agent: Agent;
  evalsId: string; // for example 20261016-174500, the folder of its results. Its workflow is skill-loaded-evals-<id>.
}

// One case from a skill's skill-loaded-evals.json: a prompt, and whether the skill should load for it
export interface SkillLoadedEvalCase {
  skill: string;
  prompt: string;
  loads: boolean;
}

// One run of a case: whether the agent loaded the skill, or why the run failed
export interface SkillLoadedEvalRun {
  loaded?: boolean; // unset when the run failed
  failure?: string;
  costUsd?: number;
}

// What one run of loadsSkill gives back
export interface SkillLoad {
  loaded: boolean;
  costUsd?: number;
  model?: string;
}

export interface SkillLoadedEvalResult extends SkillLoadedEvalCase {
  runs: SkillLoadedEvalRun[]; // the three runs, in order
  // In how many of the three runs the agent loaded the skill
  loaded: number;
  pass: boolean; // most runs did what the case expects
}

// What a run of the skill-loaded evals checked: your checkout as it is, uncommitted changes to the skills too
export interface SkillSetup {
  commit: string;
  skillsCommit: string; // the last commit that changed .agents/skills
  uncommitted: string[]; // the files in .agents/skills with changes not committed
  descriptions?: Record<string, string>; // each skill's description, as it was checked: the agent loads a skill by it
}

// A whole run of the skill-loaded evals, as it stores it in .harness/evals/results/<evalsId>/skill-loaded-evals.json
export interface SkillLoadedEvalReport extends SkillSetup {
  evalsId: string;
  startedAt: string;
  results: SkillLoadedEvalResult[];
  proposals?: string; // the improve agent's, for the failing cases, if any failed
  costUsd: number | null; // all runs together, null when a run didn't report its cost
  model?: string; // the model the runs ran with
}

// What `flows watch` shows of a running skill-loaded evals
export interface SkillLoadedEvalsStatus {
  evalsId: string;
  step: 'running' | 'writing proposals';
  runs: number; // all runs
  done: number;
  asExpected: number; // the runs done that did what their case expects
  costUsd?: number | null;
  cases?: (SkillLoadedEvalCase & { runs: (SkillLoadedEvalRun | null)[] })[]; // every case, its runs so far: null while one runs
}

// Whether a run did what its case expects. A failed run didn't.
export function asExpected(run: SkillLoadedEvalRun, loads: boolean): boolean {
  return run.loaded !== undefined && run.loaded === loads;
}
