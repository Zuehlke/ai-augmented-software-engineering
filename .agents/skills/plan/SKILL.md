---
name: plan
description: Break a feature request, spec, or plan into a backlog of tracer-bullet tickets, each declaring what blocks it; use when asked to turn a requirements document into issues or a backlog.
disable-model-invocation: true
---

## TASK

Break a feature request, a spec, or the plan already discussed in this conversation into a set of
tickets under `backlog/`. You do not implement anything.

## STEPS

1. Read the feature request in full. Look for prefactoring: work that has to land before a feature
   can be built cleanly, a schema change, a missing dataset, a pending decision. "Make the change
   easy, then make the easy change." Prefactoring gets its own ticket(s), never folded into a
   feature ticket.

2. Break the remaining scope into vertical slices, not horizontal layers:
   - Each ticket cuts a narrow but complete path through every layer it touches (schema → service →
     endpoint), not one layer shared across many tickets.
   - A completed ticket is demoable or verifiable on its own; it must own every acceptance criterion
     it's graded on, never split a single demoable outcome across two tickets.
   - Each ticket should be sized to fit in a single agent session.
   - A behaviour and its combination with what already exists, "X together with Y", is one slice, not
     two. A ticket that would only add tests or wiring for another ticket's behaviour is folded into
     that ticket. A small request is one ticket.
   - Something several tickets share, such as the page they're shown on, is built by the first
     ticket that needs it, never as a ticket of its own.

3. Give every ticket its blocking edges: which other tickets, or which external things, must land
   before it can start. A ticket with no blocker is `ready`; anything else is `blocked`, however
   well-specified it is. Other tickets go in `blocked_by`, anything outside the repo in
   `blocked_reason`: a ticket blocked only by tickets can start as soon as they are done.

4. Present the breakdown as a numbered list before writing anything: title, blocked by, what it
   delivers. Ask whether the granularity and the blocking edges are right. Iterate until the user
   approves.

5. Only after approval, write one file per ticket to `backlog/TICKET-<n>-<slug>.md`, numbered after
   the highest ticket already in `backlog/`, in dependency order (blockers first). Don't change the
   existing tickets:

   ```markdown
   ---
   id: TICKET-<n>
   status: ready | blocked
   blocked_by: <only when it waits for other tickets: their ids, for example TICKET-3, TICKET-4>
   blocked_reason: <only when it waits for something outside the repo: name it>
   ---

   # <Title: the demoable outcome>

   <One or two sentences: what this makes work, from the user's perspective, not a layer-by-layer
   implementation list.>

   ## Acceptance Criteria

   - <objectively testable, false at the current commit>
   ```

## CONSTRAINTS

- No file paths, line numbers, or code in a ticket, only the outcome and its acceptance criteria.
- Never mark a ticket `ready` if its acceptance criteria depend on another ticket's work, or on
  something outside the repo that hasn't landed yet.
- Don't invent scope the feature request doesn't ask for.
