---
name: handoff-writing
description: Write the handoff files that pass work between the phases of the research → design → implement workflow.
---

# Handoff Writing

Every phase runs in a new session and remembers nothing of the previous one. The handoff files are
the only thing the next phase gets, so write them for a reader who has no other context.

## File Location

All handoffs go to `specs/<slug>/`, where `<slug>` is a short kebab-case identifier for the feature
or change.

| Phase     | File               | Template                     |
| --------- | ------------------ | ---------------------------- |
| research  | `specification.md` | `templates/specification.md` |
| design    | `design.md`        | `templates/design.md`        |
| implement | `progress.md`      | `templates/progress.md`      |

The templates are in the `templates/` folder next to this file. Copy the template when you create a
handoff, and update the existing file instead of writing a new one.

## General Rules

- Handoff files are Markdown.
- Keep them concise and structured, no unnecessary explanation.
- Don't repeat what an earlier handoff already says, refer to it.
