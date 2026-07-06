---
name: handoff-writing
description: This skill standardizes how agents persist results as handoff files between phases in the research → plan → implement pipeline.
---

# Handoff Writing
Agents must write structured handoff files so the next agent can continue work without additional context.

## File Location
All handoffs must be written to:

specs/`<slug>`/

Where `<slug>` is a short kebab-case identifier for the feature or change.

## File Naming Convention
`<phase>`_YYYY-MM-DD.md

Where `<phase>` = if research then "specification"  | if plan then "design" | if implement then "implementation"

## Templates
Use the templates located in the `.github/skills/handoff-writing/templates/` directory:

- `research-handoff.md`
- `plan-handoff.md`
- `implement-handoff.md`

Copy the appropriate template when creating a new handoff document.

## General Rules
- Handoff files must be Markdown
- Keep them concise and structured
- Do not include unnecessary explanation
- Each handoff must allow the next agent to proceed without extra context