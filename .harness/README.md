# The harness: flows

The unattended agents of Labs 8-13 as [Temporal](https://temporal.io/) workflows, in TypeScript: the `flows`
command. The agents use the skills in `.agents/skills/`, the same ones you use yourself in the earlier labs.
The skill-loaded eval cases are next to the skills, in `skill-loaded-evals.json`.

`.harness/` holds the harness's code and what it works with:

- `src/`, `test/`, `bin/`, `package.json`: the code of `flows`, see Layout below. The agents can't change it.
- `sandbox/`: the sandbox profile every agent runs in. The agents can't change it either.
- `evals/`: the evals tasks, and their results in `evals/results/`, not committed.
- What the agents leave while they run: `progress.md` and `learnings.md`, the Ralph loop's memory, committed
  on its branch (`progress.md` goes again when the task is done), and, not committed, `run/` with the
  judge's feedback and `worktrees/`, one per agent at work.

| Lab | Temporal |
| --- | --- |
| 8 Durable workflows | `flows start "<request>"`, up to the specification it waits for you to approve, or the Research box in `flows watch`: `src/workflows/pipeline.ts` |
| 10 Ralph loop | `flows ralph <task> [--runs 1]`, `flows answer`, or in `flows watch`: Implement a task starts one run or the loop, Throw away in a task's dialog throws its work away: `src/workflows/ralph.ts`, `src/workflows/phase.ts` |
| 11 Parallelizing work | `flows ralph <task>` per task, each loop in a worktree of its own, `flows cleanup` |
| 12 Orchestration | `flows start "<request>"`, `flows approve`, `flows revise`, `flows merge`, `flows cleanup`: `src/workflows/pipeline.ts` |
| 13 Evals | `flows skill-loaded-evals`: `src/workflows/skill-loaded-evals.ts`, the cases in `.agents/skills/<skill>/skill-loaded-evals.json`. `flows evals [task] [--parallel <n>] [--yes]`, `flows evals --stop`: `src/workflows/evals.ts`, see below |

The *Ralph loop* is named after Geoffrey Huntley's technique: the same prompt runs again and again, each
time in a fresh context, and the files it leaves (`.harness/progress.md`, `.harness/learnings.md`, the
commits) are its only memory. `.harness/progress.md` and `.harness/learnings.md` don't exist until a loop
writes them.

## Roles

Each role is an agent with a skill in `.agents/skills/<name>/SKILL.md`. In the pipeline, every agent that
works is checked by a judge with the `judge` skill, which reads only the checks of that phase, in
`.agents/skills/judge/checks/<phase>.md`; `flows design` and `flows plan` on their own run their agent once, without a judge. Dispatch and merge are plain code, no agents.
`src/workflows/prompts.ts` holds what the harness adds to a skill when nobody watches.

| Role | Skill | Model | Where | Command |
| --- | --- | --- | --- | --- |
| research | `research` | Opus | `pipeline.ts` | `flows start` |
| design | `design` | Opus | `design.ts`, `pipeline.ts` | `flows design` |
| plan | `plan` | Opus | `plan.ts`, `pipeline.ts` | `flows plan` |
| dispatch | none: the tasks marked `ready`, and the blocked ones whose `blocked_by` tasks are done | none | `pipeline.ts` | |
| implement, the Ralph loop | `implement` | Sonnet | `ralph.ts` | `flows ralph` |
| judge, of the four above | `judge` | Opus | `phase.ts` | |
| review | `review` | Opus | `pipeline.ts` | `flows merge` |
| merge | none: rebase and fast-forward | none | `pipeline.ts`, `lib/git.ts` | `flows merge` |
| grader, of the evals | `review`, with the hidden criteria | Opus | `evals.ts` | `flows evals` |
| improve, after the evals | `improve`: proposes changes, changes no file | Opus | `improve.ts` | `flows evals`, `flows skill-loaded-evals` |

The model is a family (`opus`, `sonnet`, `haiku`), which `claude --model` resolves to its latest version.
`MODELS` in `src/config.ts` sets it per role: the roles that run once and shape everything after them
(research, design, plan, review) get the strongest family, the Ralph loop that runs most often the cheaper one, and
the judge is at least as strong as the agent it checks.
With `AGENT=copilot` the families map to Copilot's ids: `opus` to `gpt-6.1-sol`, since not every Copilot account offers Opus, `sonnet` and `haiku` to `claude-sonnet-5.5`, Copilot's default. `AGENT_MODELS` in `src/config.ts` holds both mappings, and `flows watch` shows the models of the agent you start next.

Implement, judge, review and the grader check a change against the same list, the `change-quality` skill. The
grader is the review skill once more, on the whole change of an evals run: it also gets the task's hidden
criteria, which no agent of the pipeline saw.

The agents work in worktrees, which only have what's committed: commit a skill after you change it. A
workflow refuses to start with uncommitted changes to a skill it uses.

Every workflow adds up what its agent runs cost, as Claude reports it, and which model each role ran with:
`flows status` and the Pipeline view of `flows watch` show it. Copilot reports no cost, so with it the cost
is unknown.

## Evals

`flows skill-loaded-evals` checks one thing, whether a skill loads: a behavioral eval. Every case in a skill's
`skill-loaded-evals.json` runs 3 times, and passes when most runs do what it expects; a run that fails counts as one that
didn't. It checks your checkout as it is, so the report notes the skill files with changes not committed. For the
failing cases, the improve agent proposes skill descriptions, for you to make. The report goes to
`.harness/evals/results/<id>/skill-loaded-evals.json`, with every run, what it cost and the model. `flows evals` grades the whole setup as it is
committed, the skills, the harness and the models, on a few fixed tasks: every task runs 3 times through
the pipeline, unattended, and each run is graded. It prints three numbers:

- **Quality**: the runs accepted, of all runs.
- **Reliability**: the tasks whose 3 runs were all accepted. Only these are candidates for unattended runs.
- **Cost per accepted change**: what all runs cost, the ones not accepted too, divided by the accepted ones.

It also prints how many runs were *first time right*: accepted, and no judge and no plain-code check rejected a step
on the way, so no run had to try again. Merged with a rejected step is quality, but not first time right. And it
prints what the runs cost per role, to see where the money goes: `costByRole` in the results.

A task is a folder in `.harness/evals/tasks/<id>/`: `request.md`, the feature request; `base`, the commit
its app code starts from; `accept/`, the hidden acceptance tests, laid out like the repository;
`criteria.md`, what the grader checks. Each run works in a copy of your repository in
`~/.flows/evals/`, with the setup of your last commit and the task's app code, without `backlog/`, `specs/`
and the evals tasks themselves. A run is accepted when its pipeline merged something, `task test` passes with the
hidden tests added, and the grader, the `review` skill with the hidden criteria, would ship it.
The pipeline's own judges and its review don't grade: they belong to the setup under test.

Before it starts, `flows evals` says what the runs will cost, by the average run of the last evals, and
asks; `--yes` doesn't ask. At most 3 runs work at the same time, `--parallel <n>` changes that. A full
pipeline run costs a few dollars, so run one task first: `flows evals min-delay-filter`. `flows evals --stop`
stops an evals run: its runs stop, and the ones that finished keep their results.

The worker restarts on a change in `.harness/src` only once no workflow runs anymore, so an evals run started
right after a commit can run on the code before it. The worker notes the files it started with
(`~/.flows/worker.harness`), and `flows evals` refuses to start when they differ from what your checkout has
committed: wait for the restart (`flows logs`), and commit what the worker runs. Committing code the worker
already runs needs no restart. A run's result also
keeps the pipeline's whole review (`review`), and when the review approved no branch, the reason has its
verdict per branch.

`flows evals --acceptance-feedback` lets a Ralph loop run the task's hidden acceptance tests when it thinks its
task is done, and tells it the names of the failing ones, never what they expect. It's off by default, because
it changes what the evals measure: the agents then get help they won't have on a real feature. Such an evals run is
marked in `evals.json` (`acceptanceFeedback`), and isn't comparable with the ones without. A task that
is only part of the feature gets feedback about the rest, so it works best when the plan agent makes one task.

The Evals tab of `flows watch` shows the trend: the three numbers of every evals, and the cases passing of
every skill-loaded evals, one column each, in the order they ran. A change within noise is dimmed, less than 3 runs
for Quality, 1 task for Reliability or 1 case for the skills, since 5 tasks of 3 runs are few. An evals run
whose models differ from the one before is marked with `*`: `opus` and `sonnet` resolve to the latest version,
so a new release changes the setup without a commit. Below, the latest e2e evals' runs per task, and the
latest skill-loaded evals' runs per case, ✓ when the run did what the case expects (`not:` marks a prompt the skill
shouldn't load for). The arrows go through the runs of both; ⏎ on a run shows why it was or wasn't accepted
and what the grader said, or what a case's run did. `s` starts an evals run from there, all tasks, one, or
the skill-loaded evals, like `flows evals` and `flows skill-loaded-evals`: it shows the estimated cost before you start it.
The results go to `.harness/evals/results/`, not committed.

A *phase* is one role's agent at work: it runs, a judge checks the run, until the judge says PASS
(`phase.ts`). The Ralph loop is a phase of many steps, one acceptance criterion each. It goes on until the
task is `done`, and stops when 3 runs in a row are rejected, by a plain-code check or by the judge. 30 runs
are a backstop, `--runs` lowers it.

The pipeline goes once through dispatch, implement, review and merge. The review is a gate: a branch it rejects
isn't merged, and the reason is in the result. Dispatch runs once. It picks the tasks marked `ready`, and the blocked ones whose
`blocked_by` tasks are done already, from an earlier pipeline. A task that waits for a task of this pipeline, or
has a `blocked_reason`, something outside the repo, doesn't start: it's reported as unfinished, and starts in a later
pipeline, or when you mark it `ready`. Attended, the pipeline asks for
your approval of the tasks and your merge decision. A *run* is one agent run with a fresh context. A *step* is where a workflow is, as its
`status` says: the pipeline goes `researching`, `planning`, … `done`.

## Layout

`src/` is laid out as a Temporal project. The folder says what may happen in a file:

```
src/
├── config.ts        the task queue, the model per role, the branch names, the limits of the runs
├── worker.ts        the worker: polls the task queue, runs the workflows and the activities
├── workflows/       deterministic: the order of the steps, no I/O, no Node modules
│   ├── pipeline.ts  ralph.ts  plan.ts  design.ts  evals.ts  skill-loaded-evals.ts  improve.ts
│   ├── phase.ts     runPhase: an agent does the work, a judge checks it. Ralph is one phase.
│   ├── prompts.ts   what each agent gets: the skill to use, and the rules for running unattended
│   ├── signals.ts   how you talk to a running workflow: the queries and signals the CLI and the page send
│   ├── map.ts       the pipeline as flows watch draws it: STAGES and BOXES, with each box's command
│   └── support/     what the workflows share: the activities' timeouts and retries, costs, verdicts, failures
├── activities/      I/O, run by the worker: agent runs, git, the backlog, the checks, the evals' copies
│   └── checks.ts    the plain-code rules before a judge: the tests, the research and the design rules
├── lib/             plain Node code anyone may use: git (rebase), the backlog, the evals' results, the worker's version
├── cli/             the `flows` command, the Temporal client: one file per command, index.ts its usage
├── web/             `flows watch`: server.ts serves it, actions.ts does what you decide, collect.ts,
│   │                view-model.ts and state.ts turn Temporal and backlog/ into what it shows
│   └── public/      the page: page.html, page.css, page.js, no build step
└── types/           the types of the agent run, the pipeline, the evals and the skill-loaded evals
```

What the labs are about, start in `src/workflows/`: `pipeline.ts`, `ralph.ts`, `phase.ts`, `prompts.ts`. In a phase,
plain code checks first, then the judge agent: a run without a commit, or with uncommitted changes, is rejected,
and one that changes `.agents/`, `.harness/sandbox`, the harness's code (`HARNESS_CODE` in `src/config.ts`) or
`Taskfile.yml` is thrown away. The agents work in worktrees, the sandbox profile comes from your checkout.

`test/`: the workflows with fake activities, the activities on real git repositories, and `flows watch`.

## Dev container

The dev container installs the Temporal CLI and this project, with `temporal` and `flows` on the `PATH`,
see `.devcontainer/install-temporal.sh`. `task flows:start` starts Temporal and the worker in the
background, `task flows:stop` stops them, see `.devcontainer/flows-services.sh`. The worker restarts by itself when this code changes, for example when you switch labs. It waits until no
workflow runs anymore: a running workflow replays its history on the worker's code, and on code that does
other steps, the replay fails and the workflow is stuck. `flows watch` shows such a workflow as stuck,
`flows cleanup` ends it. `task lab/...` runs `flows cleanup --forget` before it switches: it stops the
workflows of the lab you leave and forgets them, so the next lab starts with an empty `flows watch`.

## Run it

Lab 8 walks through it in the lab container. In short:

```bash
task flows:start                 # Temporal and the worker, in the background
task flows:watch                 # terminal 1: flows watch on http://localhost:8234, what runs, and what waits for you
flows start "<feature request>"  # terminal 2
```

`flows watch` serves a page on http://localhost:8234 (in GitHub Codespaces, the Ports tab has it): the pipeline as a
map, as in the Lab 12 diagram, with the stages, the step each box is at, where you decide, where a checkpoint sends
its handoff back and what each stage leaves; the loops and the worker's output below it, and the Evals tab once the
branch has `.harness/evals/`, from Lab 13 on. Blue is what runs, purple is what waits for you: a judge's question,
the specification and the plan approval, the merge decision. You answer or decide right there, as `flows answer`,
`flows start`, `flows approve`, `flows revise` and `flows merge` do. `flows status` shows the same in the terminal.
`flows logs` shows the worker's output, the agents' output included (in the dev container, where the worker runs in the background). The Temporal UI is on http://localhost:8233.

Outside the dev container, start Temporal and the worker yourself:
`temporal server start-dev --db-filename ~/temporal.db` and `flows worker`, each in its own terminal.

`TEMPORAL_ADDRESS` (default `localhost:7233`) and `TEMPORAL_UI` (default `http://localhost:8233`)
point the CLI and the worker somewhere else. `AGENT=copilot` uses GitHub Copilot CLI, and the Agent toggle on the page of `flows watch` switches it for what you start next.

## Develop

```bash
npm run typecheck
npm test   # downloads a local Temporal test server on the first run
```
