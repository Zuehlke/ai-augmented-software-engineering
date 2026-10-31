// The `flows` command, which bin/flows runs: the Temporal client, it starts, signals and queries the workflows.
// The usage, and which file runs each command. They share common.ts.
import { parseArgs } from 'node:util';
import { Client, Connection } from '@temporalio/client';
import { watch } from '../web/server';
import { runWorker } from '../worker';
import { cleanup } from './cleanup';
import { address, agent, repoDir } from './common';
import { evals, skillLoadedEvals } from './evals';
import { approve, merge, revise, start } from './pipeline';
import { design } from './design';
import { plan } from './plan';
import { ralph } from './ralph';
import { answer, status } from './status';

const usage = `Usage: flows <command>

  watch               shows what runs and what waits for you in your browser, on http://localhost:8234, and
                      lets you decide and answer there
  logs                shows the worker's output (the agents' output too), in the dev container
  worker              in the dev container, the worker runs in the background: task flows:start
  design --spec <file>
                      lets the design agent write the design next to a specification in specs/
  plan "<request>"    lets the plan agent turn a feature request into tasks in backlog/ (Lab 9)
                      --spec <file>: from a specification in specs/ instead, as in the pipeline
  ralph <task>      runs the Ralph loop on a task, in a worktree of its own on the branch agent/<task>
                      --runs <n>: at most n runs (default 30). --detach: start it and return
                      also: implement
  answer <workflow> "<answer>"
                      answers the judge's question, for example: flows answer ralph-TASK-1 "..."
  status [workflow]   shows what a workflow is doing, or lists all running workflows
  start "<request>"   starts the orchestration pipeline on a feature request: you approve the specification,
                      then the plan and its tasks, or send them back with your feedback
                      also: pipeline
  approve specification|plan
                      approves what the pipeline waits for, the plan with all its ready tasks
  revise specification|plan "<feedback>"
                      sends it back to the agents with your feedback
  merge               waits for the pipeline's review agent, then you decide whether to merge
                      also: review
  cleanup             stops all workflows, removes the worktrees and the merged agent/* branches
                      --forget: also deletes the finished workflows, so flows watch starts empty
                      (task lab/... does this before it switches labs)
  skill-loaded-evals  checks whether the agent loads the skills that have a skill-loaded-evals.json,
                      and lets the improve agent propose changes for the failing cases. The results go to
                      .harness/evals/results/, and show in the Evals tab of flows watch
  evals [task]        grades the setup as it is committed: runs every task in .harness/evals/tasks/ 3 times
                      through the unattended pipeline, and grades each run with the task's hidden tests
                      and criteria. The improve agent then proposes changes to the setup for the runs that
                      weren't right the first time. --parallel <n>: n runs at the same time (default 3).
                      --yes: start without asking about the cost. --stop: stops the running evals.
                      --acceptance-feedback: a loop learns, by name, which hidden acceptance tests fail
                      when it thinks a task is done (the results say so: not comparable with other evals runs)

Set AGENT=copilot to use GitHub Copilot CLI, the default is Claude Code. In flows watch, the agent menu switches it for what you start next.`;

// A number flag: undefined when it isn't given, NaN when it isn't a number (the command says how to use it)
function numberOf(flag: string | undefined): number | undefined {
  return flag === undefined ? undefined : Number(flag);
}

async function main(): Promise<number> {
  // For example `flows ralph TASK-1 --runs 1`: positionals ['ralph', 'TASK-1'], flags { runs: '1' }
  const { positionals, values: flags } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      spec: { type: 'string' }, // design, plan
      runs: { type: 'string' }, // ralph
      detach: { type: 'boolean' }, // ralph
      parallel: { type: 'string' }, // evals
      yes: { type: 'boolean' }, // evals
      stop: { type: 'boolean' }, // evals
      forget: { type: 'boolean' }, // cleanup
      'acceptance-feedback': { type: 'boolean' }, // evals
      foreground: { type: 'boolean' }, // worker, from .devcontainer/flows-services.sh
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, ...args] = positionals;
  if (flags.help) {
    console.log(usage);
    return 0;
  }
  if (command === 'worker') {
    await runWorker(address, repoDir());
    return 0;
  }
  if (command === 'watch') return watch(address, repoDir(), agent);
  const commands: Record<string, (client: Client) => Promise<number>> = {
    design: (client) => design(client, flags.spec ?? args[0]),
    plan: (client) => plan(client, args[0], flags.spec),
    ralph: (client) => ralph(client, args[0], numberOf(flags.runs), !!flags.detach),
    answer: (client) => answer(client, args[0], args[1]),
    status: (client) => status(client, args[0]),
    start: (client) => start(client, args[0]),
    approve: (client) => approve(client, args[0]),
    revise: (client) => revise(client, args[0], args[1]),
    merge,
    cleanup: (client) => cleanup(client, !!flags.forget),
    'skill-loaded-evals': skillLoadedEvals,
    evals: (client) => {
      const evalsFlags = { parallel: numberOf(flags.parallel), yes: !!flags.yes, stop: !!flags.stop, acceptanceFeedback: !!flags['acceptance-feedback'] };
      return evals(client, args[0], evalsFlags);
    },
  };
  // The same commands under the name of their role or phase
  const aliases: Record<string, string> = { implement: 'ralph', pipeline: 'start', review: 'merge' };
  const name = aliases[command] ?? command;
  if (!commands[name]) {
    console.log(usage);
    return command ? 1 : 0;
  }
  const client = new Client({ connection: await Connection.connect({ address }) });
  return commands[name](client);
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
