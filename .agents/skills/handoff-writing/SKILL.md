---
name: handoff-writing
description: Write the handoff files that pass work between the phases of the research → design → plan → implement workflow.
---

# Handoff Writing

Every phase runs in a new session and remembers nothing of the previous one. The handoff files are
the only thing the next phase gets, so write them for a reader who has no other context.

## File Location

The specification and the design go to `specs/<slug>/`, where `<slug>` is a short kebab-case
identifier for the feature or change. The tickets go to `backlog/`. The progress of what is being
implemented, a ticket or a specification, goes to `.harness/progress.md`, and is deleted when it is done.

| Phase     | File                               | Template                                |
| --------- | ---------------------------------- | --------------------------------------- |
| research  | `specs/<slug>/specification.md`    | `templates/specification.md`            |
| design    | `specs/<slug>/design.md`           | `templates/design.md`                   |
| plan      | `backlog/TICKET-<n>-<slug>.md`     | the ticket template in the `plan` skill |
| implement | `.harness/progress.md`             | `templates/progress.md`                 |

The design is optional: the unattended pipeline goes from the specification straight to the plan.

The templates are in the `templates/` folder next to this file. Copy the template when you create a
handoff, and update the existing file instead of writing a new one.

## General Rules

- Handoff files are Markdown.
- Keep them concise and structured, no unnecessary explanation.
- Don't repeat what an earlier handoff already says, refer to it.
