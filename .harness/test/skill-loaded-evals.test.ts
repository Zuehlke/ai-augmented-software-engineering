import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { ApplicationFailure } from '@temporalio/common';
import { MockActivityEnvironment, TestWorkflowEnvironment } from '@temporalio/testing';
import { DefaultLogger, Runtime, Worker } from '@temporalio/worker';
import type * as activities from '../src/activities';
import { answers } from './fakes';
import type { AgentInput } from '../src/types/agent';
import type { SkillLoadedEvalCase, SkillLoadedEvalReport, SkillLoadedEvalsStatus, SkillSetup } from '../src/types/skill-loaded-evals';
import { skillLoadedEvalsStatus } from '../src/workflows/signals';
import { describeSkillSetup } from '../src/activities/evals';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The skillLoadedEvals workflow with fake activities: no agent, no files, just the logic

let env: TestWorkflowEnvironment;
before(async () => {
  Runtime.install({ logger: new DefaultLogger('WARN') });
  env = await TestWorkflowEnvironment.createLocal();
});
after(async () => {
  await env?.teardown();
});

const cases: SkillLoadedEvalCase[] = [
  { skill: 'testing', prompt: 'add an endpoint', loads: true },
  { skill: 'testing', prompt: 'fix a typo', loads: false },
];

// What the workflow wrote to .harness/evals/results/, the last version of each report
let written: SkillLoadedEvalReport[] = [];
// What the status query answers once the workflow is done
let finalStatus: SkillLoadedEvalsStatus | undefined;

async function runSkillLoadedEvals(fakes: Partial<typeof activities>): Promise<SkillLoadedEvalReport> {
  written = [];
  finalStatus = undefined;
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: 'test',
    workflowsPath: require.resolve('../src/workflows'),
    activities: {
      listSkillLoadedEvalCases: async () => cases,
      describeSkillSetup: async () => ({ commit: 'c1', skillsCommit: 's1', uncommitted: ['.agents/skills/testing/SKILL.md'] }),
      writeSkillReport: async (_repo: string, report: SkillLoadedEvalReport) => void written.push(structuredClone(report)),
      ...fakes,
    },
  });
  return worker.runUntil(async () => {
    const handle = await env.client.workflow.start('skillLoadedEvals', {
      taskQueue: 'test',
      workflowId: `skill-loaded-evals-test-${Math.random()}`,
      args: [{ repoDir: '/repo', agent: 'claude', evalsId: '20261016-174500' }],
    });
    const report: SkillLoadedEvalReport = await handle.result();
    finalStatus = await handle.query(skillLoadedEvalsStatus);
    return report;
  });
}

test('a case passes when most of its three runs do what it expects, for failing cases the improve agent proposes changes', async () => {
  // The endpoint loads the skill in 2 of 3 runs, the typo in 2 of 3 runs too
  const calls: Record<string, number> = {};
  const inputs: AgentInput[] = [];
  const report = await runSkillLoadedEvals({
    loadsSkill: async (_repo: string, _skill: string, prompt: string) => {
      calls[prompt] = (calls[prompt] ?? 0) + 1;
      return { loaded: calls[prompt] <= 2, costUsd: 0.01, model: 'claude-sonnet-5-5' };
    },
    runAgent: async (input: AgentInput) => {
      inputs.push(input);
      return { output: '## Narrow the testing description\n', costUsd: 0.2 };
    },
  });

  assert.deepEqual(
    report.results.map(({ prompt, loaded, pass, runs }) => ({ prompt, loaded, pass, runs: runs.length })),
    [
      { prompt: 'add an endpoint', loaded: 2, pass: true, runs: 3 },
      { prompt: 'fix a typo', loaded: 2, pass: false, runs: 3 },
    ],
  );
  // The improve agent only reads, in your checkout, and finds the results itself
  assert.equal(inputs.length, 1);
  assert.deepEqual([inputs[0].mode, inputs[0].workDir, inputs[0].model], ['read', undefined, 'opus']);
  assert.match(inputs[0].prompt, /^Use the improve skill .* on the skill-loaded evals that just ran: its results are in `\.harness\/evals\/results\/20261016-174500\/`/);
  assert.equal(report.proposals, '## Narrow the testing description');
  assert.deepEqual(finalStatus && { step: finalStatus.step, done: finalStatus.done, runs: finalStatus.runs }, { step: 'writing proposals', done: 6, runs: 6 });
  // Every case with its runs, for flows watch to fill in as they finish
  assert.deepEqual(finalStatus?.cases?.map((c) => [c.prompt, c.runs.filter((run) => run?.loaded).length, c.runs.filter((run) => run?.loaded === false).length]), [
    ['add an endpoint', 2, 1],
    ['fix a typo', 2, 1],
  ]);

  // The report: what it checked, what the runs cost, with which model. Written once the runs are done, again with the proposals.
  assert.equal(report.evalsId, '20261016-174500');
  assert.deepEqual([report.commit, report.skillsCommit, report.uncommitted], ['c1', 's1', ['.agents/skills/testing/SKILL.md']]);
  assert.equal(report.costUsd?.toFixed(2), '0.06');
  assert.equal(report.model, 'claude-sonnet-5-5');
  assert.deepEqual(written.map((r) => r.proposals), [undefined, '## Narrow the testing description']);
});

test('when the improve agent fails, the skill-loaded evals still counts, and the proposals say why', async () => {
  const report = await runSkillLoadedEvals({
    loadsSkill: async () => ({ loaded: false }),
    runAgent: async () => {
      throw ApplicationFailure.nonRetryable('claude exited with code 1');
    },
  });
  assert.equal(report.results.filter((r) => !r.pass).length, 1);
  assert.equal(report.proposals, "The improve agent couldn't write proposals: claude exited with code 1");
  assert.equal(written.length, 2);
});

test('no proposals when all cases pass', async () => {
  let agentRuns = 0;
  const report = await runSkillLoadedEvals({
    loadsSkill: async (_repo: string, _skill: string, prompt: string) => ({ loaded: prompt === 'add an endpoint' }),
    runAgent: answers(async () => {
      agentRuns++;
      return '';
    }),
  });
  assert.equal(report.proposals, undefined);
  assert.equal(agentRuns, 0);
  assert.equal(written.length, 1);
  assert.equal(report.costUsd, null); // the runs didn't report what they cost
});

test('a run that fails counts as not doing what the case expects, and the others still run', async () => {
  const calls: Record<string, number> = {};
  const report = await runSkillLoadedEvals({
    loadsSkill: async (_repo: string, _skill: string, prompt: string) => {
      calls[prompt] = (calls[prompt] ?? 0) + 1;
      if (prompt === 'add an endpoint' && calls[prompt] === 1) throw ApplicationFailure.nonRetryable('claude stopped without a result');
      return { loaded: prompt === 'add an endpoint', costUsd: 0.01 };
    },
  });
  const endpoint = report.results[0];
  assert.deepEqual(endpoint.runs.filter((run) => run.failure).map((run) => run.failure), ['claude stopped without a result']);
  assert.equal(endpoint.loaded, 2);
  assert.equal(endpoint.pass, true);
  assert.equal(report.costUsd?.toFixed(2), '0.05'); // the failed run reported no cost, it doesn't make the sum unknown
  assert.deepEqual(written.length, 1);
});

test('what the skill-loaded evals checks: the commit, the skills changed but not committed, and their descriptions as they are', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'skills-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  const skill = (name: string, description: string) => {
    mkdirSync(path.join(dir, '.agents/skills', name), { recursive: true });
    writeFileSync(path.join(dir, '.agents/skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n\n## TASK\n\ndescription: not this one\n`);
    writeFileSync(path.join(dir, '.agents/skills', name, 'skill-loaded-evals.json'), '[{ "prompt": "Add an endpoint.", "loads": true }]');
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  skill('testing', 'Test-first Java coverage.');
  skill('api-design', '"API design for endpoints."');
  git('add', '.');
  git('commit', '-qm', 'Skills');
  skill('testing', 'Use for every task in this repository.');

  const setup = (await new MockActivityEnvironment().run(describeSkillSetup, dir)) as SkillSetup;
  assert.deepEqual(setup.uncommitted, ['.agents/skills/testing/SKILL.md']);
  assert.deepEqual(setup.descriptions, { 'api-design': 'API design for endpoints.', testing: 'Use for every task in this repository.' });
});
