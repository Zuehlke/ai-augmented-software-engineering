import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ApplicationFailure } from '@temporalio/common';
import type { TestResult } from '../types/pipeline';
import type { EvalsReport, EvalsRun, EvalsTask, Setup } from '../types/evals';
import type { SkillLoadedEvalReport, SkillSetup } from '../types/skill-loaded-evals';
import { RESULTS } from '../results';
import { staleWorker } from '../version';
import { HARNESS_CODE } from '../shared';
import { exec, git } from './exec';
import { truncate } from './repo';

// Every activity has to be safe to run twice: Temporal retries it when it fails or its worker dies.

const TASKS = '.harness/evals/tasks';

// What a run's copy takes from the task's start commit: the app code. Everything else, the skills, the
// harness, the models and the build setup (pom.xml, which the agents' sandbox needs to run the tests), is the
// setup under test, and comes from your checkout's last commit.
const APP = ['src'];
// What a run's copy doesn't get: tickets and specifications of other work, which the pipeline would pick
// up, and the evals tasks themselves, with every task's hidden acceptance tests
const LEFT_OUT = ['backlog', 'specs', '.harness/evals'];

// The evals' tasks, or only the one named. Fails for good if it doesn't exist.
export async function listEvalsTasks(repoDir: string, only?: string): Promise<EvalsTask[]> {
  const dir = path.join(repoDir, TASKS);
  const ids = existsSync(dir) ? (await readdir(dir)).sort() : [];
  if (only && !ids.includes(only)) {
    throw ApplicationFailure.nonRetryable(`There is no evals task ${only}. The tasks: ${ids.join(', ') || 'none'}, in ${TASKS}/.`);
  }
  const tasks: EvalsTask[] = [];
  for (const id of only ? [only] : ids) {
    const read = (name: string) => readFile(path.join(dir, id, name), 'utf8');
    tasks.push({ id, request: (await read('request.md')).trim(), base: (await read('base')).trim() });
  }
  return tasks;
}

// The commits of the setup the evals grades, as your checkout has them committed
export async function describeSetup(repoDir: string): Promise<Setup> {
  // An evals run names the harness it graded. If the worker runs another one, it would name the wrong one.
  const stale = staleWorker(repoDir);
  if (stale) throw ApplicationFailure.nonRetryable(stale);
  const last = async (...paths: string[]) => (await git(repoDir, 'log', '-1', '--format=%H', 'HEAD', '--', ...paths)).trim();
  return {
    commit: (await git(repoDir, 'rev-parse', 'HEAD')).trim(),
    skillsCommit: await last('.agents/skills'),
    harnessCommit: await last(...HARNESS_CODE),
  };
}

// Where a run's copy lives, outside your checkout: ~/.flows/evals/<evalsId>/<task>-<run>
function copyDir(evalsId: string, task: string, run: number): string {
  return path.join(process.env.FLOWS_EVALS_DIR ?? path.join(os.homedir(), '.flows/evals'), evalsId, `${task}-${run}`);
}

// A copy of your repository for one run, on the branch `evals`: the setup from `commit`, the app code from
// the task's start commit, without backlog/, specs/ and the evals. Returns its folder, where the pipeline
// runs and merges, and the commit it starts from. A retry starts it over.
export async function prepareRun(repoDir: string, commit: string, evalsId: string, task: EvalsTask, run: number): Promise<{ dir: string; base: string }> {
  const dir = copyDir(evalsId, task.id, run);
  await rm(dir, { recursive: true, force: true });
  await mkdir(path.dirname(dir), { recursive: true });
  // --shared: it borrows your checkout's objects instead of linking them, which fails across file systems
  await git(repoDir, 'clone', '--quiet', '--shared', '--no-checkout', repoDir, dir);
  await git(dir, 'checkout', '--quiet', '-B', 'evals', commit);
  await git(dir, 'rm', '-r', '--quiet', '--ignore-unmatch', ...APP, ...LEFT_OUT);
  await git(dir, 'checkout', task.base, '--', ...APP);
  await git(dir, 'commit', '--quiet', '-m', `Evals ${evalsId}: ${task.id}, run ${run}, the app code of ${task.base.slice(0, 7)}`);
  return { dir, base: (await git(dir, 'rev-parse', 'HEAD')).trim() };
}

// The task's hidden acceptance tests go into `dir`, all the tests run, and the hidden ones go again: the
// grader reads the folder, and shouldn't see them
async function withHiddenTests<T>(repoDir: string, dir: string, task: string, run: (files: string[]) => Promise<T>): Promise<T> {
  const source = path.join(repoDir, TASKS, task, 'accept');
  const files = await filesIn(source);
  await cp(source, dir, { recursive: true });
  try {
    return await run(files);
  } finally {
    for (const file of files) await rm(path.join(dir, file), { force: true });
  }
}

async function filesIn(dir: string, prefix = ''): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(path.join(dir, prefix), { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...(await filesIn(dir, relative)));
    else files.push(relative);
  }
  return files;
}

// After the pipeline: the hidden acceptance tests and all the others
export async function acceptRun(repoDir: string, dir: string, task: string): Promise<TestResult> {
  return withHiddenTests(repoDir, dir, task, async () => {
    const { code, output } = await exec(dir, 'task', ['test'], { quiet: true });
    return { pass: code === 0, tail: output.slice(-3_000) };
  });
}

// The hidden tests that fail in a loop's worktree, by name only, as `StatusFilterAcceptanceTest.aTest`: a loop
// shouldn't learn what they expect. Empty when they pass.
export async function failingHiddenTests(repoDir: string, workDir: string, task: string): Promise<string[]> {
  return withHiddenTests(repoDir, workDir, task, async (files) => {
    const { code, output } = await exec(workDir, 'task', ['test'], { quiet: true });
    if (code === 0) return [];
    const hidden = new Set(files.map((file) => path.basename(file, path.extname(file))));
    // Surefire's summary: `[ERROR]   StatusFilterAcceptanceTest.anyOtherStatusIsABadRequest:61 Status expected…`
    const failed = [...output.matchAll(/^\[ERROR\]\s+(\w+\.\w+)(?::\d+)?\b/gm)].map((match) => match[1]);
    const names = failed.filter((name) => hidden.has(name.split('.')[0]));
    return names.length ? [...new Set(names)] : ['the tests don\'t compile or don\'t run'];
  });
}

// What the grader gets: the task's hidden criteria, and everything the run changed since `base`,
// the commit its copy started from
export async function gradeInput(repoDir: string, dir: string, task: string, base: string): Promise<{ criteria: string; change: string }> {
  const file = path.join(repoDir, TASKS, task, 'criteria.md');
  if (!existsSync(file)) throw ApplicationFailure.nonRetryable(`The evals task ${task} has no criteria.md for the grader.`);
  return { criteria: (await readFile(file, 'utf8')).trim(), change: truncate(await git(dir, 'diff', base, 'HEAD'), 90_000) };
}

export async function removeCopy(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

// One run's result: .harness/evals/results/<evalsId>/<task>-<run>.json
export async function writeRun(repoDir: string, evalsId: string, run: EvalsRun): Promise<void> {
  const dir = path.join(repoDir, RESULTS, evalsId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${run.task}-${run.run}.json`), JSON.stringify(run, null, 2) + '\n');
}

// The whole evals: .harness/evals/results/<evalsId>/evals.json
export async function writeReport(repoDir: string, report: EvalsReport): Promise<void> {
  const dir = path.join(repoDir, RESULTS, report.evalsId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'evals.json'), JSON.stringify(report, null, 2) + '\n');
}

// What the skill-loaded evals checks: your checkout as it is, so it notes what in .agents/skills isn't committed
export async function describeSkillSetup(repoDir: string): Promise<SkillSetup> {
  const status = await git(repoDir, 'status', '--porcelain', '--', '.agents/skills');
  return {
    commit: (await git(repoDir, 'rev-parse', 'HEAD')).trim(),
    skillsCommit: (await git(repoDir, 'log', '-1', '--format=%H', 'HEAD', '--', '.agents/skills')).trim(),
    uncommitted: status.split('\n').filter(Boolean).map((line) => line.slice(3)),
  };
}

// A whole run of the skill-loaded evals: .harness/evals/results/<evalsId>/skill-loaded-evals.json
export async function writeSkillReport(repoDir: string, report: SkillLoadedEvalReport): Promise<void> {
  const dir = path.join(repoDir, RESULTS, report.evalsId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'skill-loaded-evals.json'), JSON.stringify(report, null, 2) + '\n');
}
