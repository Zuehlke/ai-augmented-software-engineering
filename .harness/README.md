# The harness: flows

The unattended agents of Labs 9-13 as [Temporal](https://temporal.io/) workflows, in TypeScript: the `flows`
command. The agents use the skills in `.agents/skills/`, the same ones you use yourself in the earlier labs.
The skill-loaded eval cases are next to the skills, in `skill-loaded-evals.json`.

`.harness/` holds the harness's code and what it works with:

- `src/`, `test/`, `bin/`, `package.json`: the code of `flows`, see Layout below. The agents can't change it.
- `sandbox/`: the sandbox profile every agent runs in. The agents can't change it either.
- `evals/`: the evals tasks, and their results in `evals/results/`, not committed.
- What the agents leave while they run: `progress.md` and `learnings.md`, the Ralph loop's memory, committed
  on its branch (`progress.md` goes again when the ticket is done), and, not committed, `run/` with the
  judge's feedback and `worktrees/`, one per agent at work.

| Lab | Temporal |
| --- | --- |
| 9 Durable workflows | `flows plan "<request>"`: `src/workflows/plan.ts` |
| 10 Ralph loop | `flows ralph <ticket> [--runs 1]`, `flows answer`, or on the board of `flows watch`: `s` starts one run or the loop, `x` throws a loop's work away: `src/workflows/ralph.ts`, `src/workflows/phase.ts` |
| 11 Parallelizing work | `flows ralph <ticket>` per ticket, each loop in a worktree of its own, `flows cleanup` |
| 12 Orchestration | `flows start "<request>"`, `flows merge`, `flows cleanup`: `src/workflows/pipeline.ts` |
| 13 Evals | `flows skill-loaded-evals`: `src/workflows/skill-loaded-evals.ts`, the cases in `.agents/skills/<skill>/skill-loaded-evals.json`. `flows evals [task] [--parallel <n>] [--yes]`, `flows evals --stop`: `src/workflows/evals.ts`, see below |

The *Ralph loop* is named after Geoffrey Huntley's technique: the same prompt runs again and again, each
time in a fresh context, and the files it leaves (`.harness/progress.md`, `.harness/learnings.md`, the
commits) are its only memory. `.harness/progress.md` and `.harness/learnings.md` don't exist until a loop
writes them.

## Roles

Each role is an agent with a skill in `.agents/skills/<name>/SKILL.md`. In the pipeline, every agent that
works is checked by a judge with the `judge` skill, which reads only the checks of that phase, in
`.agents/skills/judge/checks/<phase>.md`; `flows plan` on its own runs the plan agent once, without a judge. Dispatch and merge are plain code, no agents.
`src/workflows/prompts.ts` holds what the harness adds to a skill when nobody watches.

| Role | Skill | Model | Where | Command |
| --- | --- | --- | --- | --- |
| research | `research` | Opus | `pipeline.ts` | `flows start` |
| plan | `plan` | Opus | `plan.ts`, `pipeline.ts` | `flows plan` |
| dispatch | none: the tickets marked `ready`, and the blocked ones whose `blocked_by` tickets are done | none | `pipeline.ts` | |
| implement, the Ralph loop | `implement` | Sonnet | `ralph.ts` | `flows ralph` |
| judge, of the three above | `judge` | Opus | `phase.ts` | |
| review | `review` | Opus | `pipeline.ts` | `flows merge` |
| merge | none: rebase and fast-forward | none | `pipeline.ts`, `rebase.ts` | `flows merge` |
| grader, of the evals | `review`, with the hidden criteria | Opus | `evals.ts` | `flows evals` |
| improve, after the evals | `improve`: proposes changes, changes no file | Opus | `improve.ts` | `flows evals`, `flows skill-loaded-evals` |

The model is a family (`opus`, `sonnet`, `haiku`), which `claude --model` resolves to its latest version.
`MODELS` in `src/shared.ts` sets it per role: the roles that run once and shape everything after them
(research, plan, review) get the strongest family, the Ralph loop that runs most often the cheaper one, and
the judge is at least as strong as the agent it checks.
With `AGENT=copilot` the families map to Copilot's ids, `claude-opus-5` and `claude-sonnet-5`, see `src/activities/agent.ts`.

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
ticket is done, and tells it the names of the failing ones, never what they expect. It's off by default, because
it changes what the evals measure: the agents then get help they won't have on a real feature. Such an evals run is
marked in `evals.json` (`acceptanceFeedback`), and isn't comparable with the ones without. A ticket that
is only part of the feature gets feedback about the rest, so it works best when the plan agent makes one ticket.

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
ticket is `done`, and stops when 3 runs in a row are rejected, by a plain-code check or by the judge. 30 runs
are a backstop, `--runs` lowers it.

The pipeline goes once through dispatch, implement, review and merge. The review is a gate: a branch it rejects
isn't merged, and the reason is in the result. Dispatch runs once. It picks the tickets marked `ready`, and the blocked ones whose
`blocked_by` tickets are done already, from an earlier pipeline. A ticket that waits for a ticket of this pipeline, or
has a `blocked_reason`, something outside the repo, doesn't start: it's reported as unfinished, and starts in a later
pipeline, or when you mark it `ready`. Attended, the pipeline asks for
your approval of the tickets and your merge decision. A *run* is one agent run with a fresh context. A *step* is where a workflow is, as its
`status` says: the pipeline goes `researching`, `planning`, … `done`.

## Layout

What the labs are about, start here:

- `src/workflows/`: the workflows. No I/O here, every side effect is an activity.
- `src/workflows/phase.ts`: `runPhase`, an agent does the work and a judge checks it. Ralph is one phase.
  Plain code checks first, then the judge agent: a run without a commit, or with uncommitted changes,
  is rejected, and one that changes `.agents/`, `.harness/sandbox`, the harness's code (`HARNESS_CODE` in `src/shared.ts`) or `Taskfile.yml`
  is thrown away. The agents work in worktrees, the sandbox profile comes from your checkout.
- `src/workflows/prompts.ts`: what each agent gets: the skill to use, and the rules for running unattended
- `src/workflows/signals.ts`: how you talk to a running workflow, the queries and signals the CLI sends
- `src/workflows/text.ts`: reads the verdict at the end of a judge's, the review agent's or the grader's answer
- `src/workflows/usage.ts`: adds up what the agent runs cost, `src/workflows/failure.ts`: the message of a failure
- `src/workflows/activities.ts`: timeouts and retry policies of the activities
- `src/activities/`: agent runs, git, tests, files, and the evals' copies of the repository
- `src/shared.ts`: what everything shares: the agents, the model per role (`MODELS`), the branch names `agent/<ticket>`
- `src/types/`: the types of each feature, the agent run, the pipeline, the evals and the skill-loaded evals
- `src/backlog.ts`: reads the tickets in `backlog/`, `src/rebase.ts`: brings an agent's branch into yours
- `src/worker.ts`: the worker
- `src/cli/`: the `flows` command, `index.ts` its usage and commands, one file per command
- `test/`: workflow tests with fake activities

Tooling you don't need to read for the labs:

- `src/watch/`: `flows watch`, a terminal UI that shows what runs and what waits for you. It only looks at
  Temporal and `backlog/`, and sends the same signals as `flows answer`, `flows start` and `flows merge`.
  `collect.ts` reads the state, `model.ts` turns it into what shows, `view/` draws it, one file per tab.

## Dev container

The dev container installs the Temporal CLI and this project, with `temporal` and `flows` on the `PATH`,
see `.devcontainer/install-temporal.sh`. `task flows:start` starts Temporal and the worker in the
background, `task flows:stop` stops them, see `.devcontainer/flows-services.sh`. The worker restarts by itself when this code changes, for example when you switch labs. It waits until no
workflow runs anymore: a running workflow replays its history on the worker's code, and on code that does
other steps, the replay fails and the workflow is stuck. `flows watch` shows such a workflow as stuck,
`flows cleanup` ends it. `task lab/...` runs `flows cleanup --forget` before it switches: it stops the
workflows of the lab you leave and forgets them, so the next lab starts with an empty `flows watch`.

## Run it

Lab 9 walks through it in the lab container. In short:

```bash
task flows:start                 # Temporal and the worker, in the background
task flows:watch                 # terminal 1: flows watch, what runs, and what waits for you
flows plan "<feature request>"   # terminal 2
```

`flows watch` shows the pipeline as in the Lab 12 diagram (Tab switches to the backlog as a board, and to the
Evals tab once the branch has `.harness/evals/`, from Lab 13 on).
Blue is what runs, purple is what waits for you: a judge's question, the ticket approval, the merge
decision. It asks the terminal whether it's light or dark; `FLOWS_THEME=light` or `dark` decides instead. Enter answers or decides right there, as `flows answer`, `flows start` and `flows merge` do.
`flows logs` shows the worker's output, the agents' output included (in the dev container, where the worker runs in the background). The Temporal UI is on http://localhost:8233.

Outside the dev container, start Temporal and the worker yourself:
`temporal server start-dev --db-filename ~/temporal.db` and `flows worker`, each in its own terminal.

`TEMPORAL_ADDRESS` (default `localhost:7233`) and `TEMPORAL_UI` (default `http://localhost:8233`)
point the CLI and the worker somewhere else. `AGENT=copilot` uses GitHub Copilot CLI, and `a` in `flows watch` switches it for what you start next.

## Develop

```bash
npm run typecheck
npm test   # downloads a local Temporal test server on the first run
```
