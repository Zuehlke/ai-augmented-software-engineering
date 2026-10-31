// The evals' results in .harness/evals/results/, for `flows evals` and `flows watch`
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { dollars } from '../config';
import type { EvalsReport } from '../types/evals';
import type { SkillLoadedEvalReport } from '../types/skill-loaded-evals';

export const RESULTS = '.harness/evals/results';

// Every evals run that finished, the oldest first. An evals run that was stopped has no evals.json and isn't one.
export function readHistory(repoDir: string): EvalsReport[] {
  return read<EvalsReport>(repoDir, 'evals.json');
}

// Every run of the skill-loaded evals that finished, the oldest first: the folders with a skill-loaded-evals.json
export function readSkillHistory(repoDir: string): SkillLoadedEvalReport[] {
  return read<SkillLoadedEvalReport>(repoDir, 'skill-loaded-evals.json');
}

function read<T>(repoDir: string, name: string): T[] {
  const dir = path.join(repoDir, RESULTS);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .map((id) => path.join(dir, id, name))
    .filter((file) => existsSync(file))
    .map((file) => JSON.parse(readFileSync(file, 'utf8')) as T);
}

// A new evals run's id, from when it starts: 20261016-174500, in UTC. Its workflow is evals-<id>.
export function newEvalsId(now = new Date()): string {
  return now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
}

// What `runs` runs will cost, by the average run of the last evals: undefined without an evals run before,
// null when the last evals' cost is unknown
export function estimate(history: EvalsReport[], runs: number): number | null | undefined {
  const last = history.at(-1);
  if (!last || !last.runs.length) return undefined;
  return last.costUsd === null ? null : (last.costUsd / last.runs.length) * runs;
}

// An estimate as the start of an evals shows it: about $4.20, by the last evals. `kind`: evals or skill-loaded evals.
export function estimateText(expected: number | null | undefined, kind: string): string {
  if (expected === undefined) return `unknown, there was no ${kind} yet`;
  if (expected === null) return 'unknown';
  return `about ${dollars(expected)}, by the last ${kind}`;
}

// What `flows skill-loaded-evals` prints at the end: every skill's cases, and why a run failed
export function formatSkillReport(report: SkillLoadedEvalReport): string[] {
  const lines: string[] = [];
  for (const skill of new Set(report.results.map((result) => result.skill))) {
    const cases = report.results.filter((result) => result.skill === skill);
    lines.push(`== ${skill}: ${cases.filter((c) => c.pass).length} of ${cases.length} cases pass`);
    for (const { pass, loads, loaded, prompt, runs } of cases) {
      const expected = loads ? 'should load' : "shouldn't load";
      lines.push(`${pass ? 'PASS' : 'FAIL'}  ${expected.padEnd(15)}  loaded in ${loaded} of ${runs.length} runs  ${prompt}`);
      runs.forEach((run, i) => run.failure && lines.push(`      run ${i + 1} failed: ${run.failure.split('\n')[0]}`));
    }
  }
  const failed = report.results.filter((result) => !result.pass).length;
  lines.push(`${report.results.length - failed} cases passed, ${failed} failed. Cost ${dollars(report.costUsd)}.`);
  if (report.uncommitted.length) lines.push(`Checked with changes not committed: ${report.uncommitted.join(', ')}`);
  if (report.proposals) lines.push('', 'The improve agent proposes, for the failing cases:', '', report.proposals, '');
  lines.push(`Results: ${RESULTS}/${report.evalsId}/`);
  return lines;
}

// What `flows evals` prints at the end: every task's runs, why the ones not accepted weren't, and the numbers
export function formatReport(report: EvalsReport): string[] {
  const lines: string[] = [];
  const width = Math.max(4, ...report.tasks.map((task) => task.length));
  for (const task of report.tasks) {
    const runs = report.runs.filter((run) => run.task === task);
    lines.push(`${task.padEnd(width)}  ${runs.map((run) => (run.accepted ? '✓' : '✗')).join(' ')}`);
  }
  const rejected = report.runs.filter((run) => !run.accepted);
  if (rejected.length) lines.push('', 'Not accepted:');
  for (const run of rejected) lines.push(`  ${run.task} run ${run.run}: ${run.reason.split('\n')[0]}`);

  const perAccepted = report.costPerAccepted === undefined ? '–' : dollars(report.costPerAccepted);
  lines.push(
    '',
    `Quality      ${report.quality.accepted} / ${report.quality.of} runs accepted`,
    `Reliability  ${report.reliability.tasks} / ${report.reliability.of} tasks with every run accepted`,
    ...(report.firstTimeRight ? [`First time   ${report.firstTimeRight.runs} / ${report.firstTimeRight.of} runs accepted without a judge or a test rejecting a step`] : []),
    `Cost         ${perAccepted} per accepted change, ${dollars(report.costUsd)} in total`,
  );
  const costs = Object.entries(report.costByRole ?? {});
  if (costs.length) lines.push('', 'Cost by role:', ...costs.map(([role, cost]) => `  ${role.padEnd(10)} ${dollars(cost)}`));
  const models = Object.entries(report.models);
  if (models.length) lines.push('', 'Models:', ...models.map(([role, model]) => `  ${role.padEnd(10)} ${model}`));
  if (report.proposals) lines.push('', 'The improve agent proposes, for the runs that weren\'t right the first time:', '', report.proposals);
  lines.push('', `Results: ${RESULTS}/${report.evalsId}/`);
  return lines;
}
