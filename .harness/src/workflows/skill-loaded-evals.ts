import { isCancellation, setHandler } from '@temporalio/workflow';
import type { SkillLoadedEvalInput, SkillLoadedEvalReport, SkillLoadedEvalResult, SkillLoadedEvalRun, SkillLoadedEvalsStatus } from '../types/skill-loaded-evals';
import { asExpected } from '../types/skill-loaded-evals';
import { describeSkillSetup, listSkillLoadedEvalCases, loadsSkill, writeSkillReport } from './activities';
import { failureMessage } from './failure';
import { propose } from './improve';
import { skillLoadedEvalsStatus } from './signals';
import { addCost } from './usage';

// Runs every case three times, because agent output varies from run to run. A case passes when
// most runs do what it expects. All runs start at once. Writes the report to .harness/evals/results/.
export async function skillLoadedEvals({ repoDir, agent, evalsId }: SkillLoadedEvalInput): Promise<SkillLoadedEvalReport> {
  const startedAt = new Date().toISOString(); // the workflow's clock: the same on every replay
  // The cases from every .agents/skills/<skill>/skill-loaded-evals.json
  const cases = await listSkillLoadedEvalCases(repoDir);
  const status: SkillLoadedEvalsStatus = { evalsId, step: 'running', runs: cases.length * 3, done: 0, asExpected: 0 };
  setHandler(skillLoadedEvalsStatus, () => status);
  const setup = await describeSkillSetup(repoDir);
  let model: string | undefined;

  // One run of a case. A run that keeps failing is a run that didn't do what the case expects, the others still count.
  const once = async (skill: string, prompt: string, loads: boolean): Promise<SkillLoadedEvalRun> => {
    let run: SkillLoadedEvalRun;
    try {
      const load = await loadsSkill(repoDir, skill, prompt);
      model ??= load.model;
      run = { loaded: load.loaded, costUsd: load.costUsd };
      status.costUsd = addCost(status.costUsd, load.costUsd);
    } catch (err) {
      if (isCancellation(err)) throw err;
      run = { failure: failureMessage(err) };
    }
    status.done++;
    if (asExpected(run, loads)) status.asExpected++;
    return run;
  };

  const results: SkillLoadedEvalResult[] = await Promise.all(
    cases.map(async ({ skill, prompt, loads }) => {
      const runs = await Promise.all([1, 2, 3].map(() => once(skill, prompt, loads)));
      const loaded = runs.filter((run) => run.loaded).length;
      const expected = runs.filter((run) => asExpected(run, loads)).length;
      return { skill, prompt, loads, runs, loaded, pass: expected >= 2 };
    }),
  );

  const costUsd = status.costUsd === undefined ? 0 : status.costUsd; // no runs, no cost
  const report: SkillLoadedEvalReport = { evalsId, startedAt, ...setup, results, costUsd, model };
  await writeSkillReport(repoDir, report);

  // Failing cases: the improve agent proposes skill descriptions. The pipeline can't change the skills, you do.
  const failing = results.filter((result) => !result.pass);
  if (failing.length === 0) return report;
  status.step = 'writing proposals';
  report.proposals = await propose(repoDir, agent, 'skill-loaded evals', evalsId);
  await writeSkillReport(repoDir, report);
  return report;
}
