---
name: plan
description: Break a feature request, spec, or plan into a backlog of tracer-bullet tasks, each declaring what blocks it; use when asked to turn a requirements document into issues or a backlog.
disable-model-invocation: true
---

## TASK

Break a feature request, a spec, or the plan already discussed in this conversation into a set of
tasks under `backlog/`. You do not implement anything.

## STEPS

1. Read the feature request in full, and the `design.md` next to a specification, if there is one: cut
   the tasks along its decisions. Look for prefactoring: work that has to land before a feature
   can be built cleanly, a schema change, a missing dataset, a pending decision. "Make the change
   easy, then make the easy change." Prefactoring gets its own task(s), never folded into a
   feature task.

2. Break the remaining scope into vertical slices, not horizontal layers:
   - Each task cuts a narrow but complete path through every layer it touches (schema → service →
     endpoint), not one layer shared across many tasks.
   - A completed task is demoable or verifiable on its own; it must own every acceptance criterion
     it's graded on, never split a single demoable outcome across two tasks.
   - Each task should be sized to fit in a single agent session.
   - A behaviour and its combination with what already exists, "X together with Y", is one slice, not
     two. A task that would only add tests or wiring for another task's behaviour is folded into
     that task. A small request is one task.
   - Something several tasks share, such as the page they're shown on, is built by the first
     task that needs it, never as a task of its own.

3. Give every task its blocking edges: which other tasks, or which external things, must land
   before it can start. A task with no blocker is `ready`; anything else is `blocked`, however
   well-specified it is. Other tasks go in `blocked_by`, anything outside the repo in
   `blocked_reason`: a task blocked only by tasks can start as soon as they are done.

4. Present the breakdown as a numbered list before writing anything: title, blocked by, what it
   delivers. Ask whether the granularity and the blocking edges are right. Iterate until the user
   approves.

5. Only after approval, write one file per task to `backlog/TASK-<n>-<slug>.md`, numbered after
   the highest task already in `backlog/`, in dependency order (blockers first). Don't change the
   existing tasks:

   ```markdown
   ---
   id: TASK-<n>
   status: ready | blocked
   blocked_by: <only when it waits for other tasks: their ids, for example TASK-3, TASK-4>
   blocked_reason: <only when it waits for something outside the repo: name it>
   design: <only when you cut it from a design: its path, for example specs/<slug>/design.md>
   ---

   # <Title: the demoable outcome>

   <One or two sentences: what this makes work, from the user's perspective, not a layer-by-layer
   implementation list.>

   ## Acceptance Criteria

   - <objectively testable, false at the current commit>
   ```

## CONSTRAINTS

- No file paths, line numbers, or code in a task, only the outcome and its acceptance criteria.
- Never mark a task `ready` if its acceptance criteria depend on another task's work, or on
  something outside the repo that hasn't landed yet.
- Don't invent scope the feature request doesn't ask for.
