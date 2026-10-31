import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { DefaultLogger, Runtime, Worker } from '@temporalio/worker';
import type { AgentInput } from '../src/types/agent';

// The plan workflow with fake activities: no agent, no files, no git

let env: TestWorkflowEnvironment;
before(async () => {
  Runtime.install({ logger: new DefaultLogger('WARN') });
  env = await TestWorkflowEnvironment.createLocal();
});
after(async () => {
  await env?.teardown();
});

// What the fake git did: the plan agent's worktree, and which branch came onto yours
let calls: string[] = [];
const git = {
  headCommit: async () => 'base',
  currentBranch: async () => 'main',
  addWorktree: async (_repo: string, name: string, branch: string) => (calls.push(`add ${branch}`), `/worktrees/${name}`),
  mergeBranch: async (_repo: string, branch: string, into: string) => (calls.push(`merge ${branch} into ${into}`), null),
  removeWorktree: async (_repo: string, name: string) => void calls.push(`remove ${name}`),
  requireCommitted: async (_repo: string, file: string) => void calls.push(`committed ${file}`),
};

test('one agent run with the plan prompt and the request, returns the new tasks', async () => {
  const runs: AgentInput[] = [];
  calls = [];
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: 'test',
    workflowsPath: require.resolve('../src/workflows'),
    activities: {
      ...git,
      listTasks: async () => (runs.length ? ['TASK-1', 'TASK-2', 'TASK-3'] : ['TASK-1']),
      runAgent: async (input: AgentInput) => {
        runs.push(input);
        return '';
      },
    },
  });
  const result = await worker.runUntil(
    env.client.workflow.execute('plan', {
      taskQueue: 'test',
      workflowId: `plan-test-${Math.random()}`,
      args: [{ repoDir: '/repo', agent: 'claude', request: 'Filter delays by airline' }],
    }),
  );

  assert.deepEqual(result, ['TASK-2', 'TASK-3']);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].mode, 'write');
  assert.match(runs[0].prompt, /^Use the plan skill in `\.agents\/skills\/plan\/SKILL\.md`[\s\S]*\nFeature request: Filter delays by airline$/);
  // The plan agent works in a worktree, its branch comes onto yours, then the worktree goes
  assert.equal(runs[0].repoDir, '/repo'); // the sandbox profile comes from your checkout
  const name = runs[0].workDir!.slice('/worktrees/'.length);
  assert.match(name, /^plan-\w{8}$/);
  assert.deepEqual(calls, ['committed .agents/skills/plan/SKILL.md', `add agent/${name}`, `merge agent/${name} into main`, `remove ${name}`]);
});

test('with a specification, the plan agent gets that instead of a feature request', async () => {
  const runs: AgentInput[] = [];
  calls = [];
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: 'test',
    workflowsPath: require.resolve('../src/workflows'),
    activities: {
      ...git,
      listTasks: async () => (runs.length ? ['TASK-1', 'TASK-2', 'TASK-3'] : ['TASK-1']),
      runAgent: async (input: AgentInput) => {
        runs.push(input);
        return '';
      },
    },
  });
  const result = await worker.runUntil(
    env.client.workflow.execute('plan', {
      taskQueue: 'test',
      workflowId: `plan-test-${Math.random()}`,
      args: [{ repoDir: '/repo', agent: 'claude', spec: 'specs/filter/specification.md' }],
    }),
  );

  assert.deepEqual(result, ['TASK-2', 'TASK-3']);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].mode, 'write');
  assert.match(runs[0].prompt, /\nSpecification: specs\/filter\/specification\.md$/);
  assert.equal(calls[0], 'committed specs/filter/specification.md'); // the worktree only has what's committed
});

test('the design agent on its own: one run with the specification, its design comes onto your branch', async () => {
  const runs: AgentInput[] = [];
  calls = [];
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: 'test',
    workflowsPath: require.resolve('../src/workflows'),
    activities: {
      ...git,
      designProblem: async () => null,
      runAgent: async (input: AgentInput) => {
        runs.push(input);
        return '';
      },
    },
  });
  const result = await worker.runUntil(
    env.client.workflow.execute('design', {
      taskQueue: 'test',
      workflowId: `design-test-${Math.random()}`,
      args: [{ repoDir: '/repo', agent: 'claude', spec: 'specs/delays/specification.md' }],
    }),
  );

  assert.equal(result, 'specs/delays/design.md');
  assert.equal(runs.length, 1);
  assert.match(runs[0].prompt, /^Use the design skill in `\.agents\/skills\/design\/SKILL\.md`[\s\S]*\nSpecification: specs\/delays\/specification\.md$/);
  const name = runs[0].workDir!.slice('/worktrees/'.length);
  assert.match(name, /^design-\w{8}$/);
  assert.deepEqual(calls, ['committed specs/delays/specification.md', 'committed .agents/skills/design/SKILL.md', `add agent/${name}`, `merge agent/${name} into main`, `remove ${name}`]);
});

test('a design that breaks the rule fails, and stays on its branch', async () => {
  calls = [];
  const worker = await Worker.create({
    connection: env.nativeConnection,
    taskQueue: 'test',
    workflowsPath: require.resolve('../src/workflows'),
    activities: { ...git, designProblem: async () => "you didn't write the design.", runAgent: async () => '' },
  });
  await worker.runUntil(async () => {
    const handle = await env.client.workflow.start('design', {
      taskQueue: 'test',
      workflowId: `design-test-${Math.random()}`,
      args: [{ repoDir: '/repo', agent: 'claude', spec: 'specs/delays/specification.md' }],
    });
    await assert.rejects(handle.result(), (err: Error & { cause?: Error }) => /The design isn't right: you didn't write the design\./.test(err.cause?.message ?? ''));
  });
  assert.ok(!calls.some((call) => call.startsWith('merge')));
});
