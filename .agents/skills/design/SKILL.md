---
name: design
description: Turn a specification into a design that names the modules, endpoints and tests to change and how they integrate.
disable-model-invocation: true
---

## TASK

You are creating a design for the implementation of a requirement.

The design must be detailed enough to allow a human or less capable coding agent to implement it, but it should be as concise as possible to avoid overload.

Do not repeat the requirements — the implement phase reads the specification itself.

Focus on architectural building blocks:
- which modules to change
- which functions or endpoints to create or modify
- which tests must be written
- how components integrate

Do not include unnecessary code-level implementation details.

DO NOT refer to anything as “optional” or “not needed”. Clearly specify exactly which changes must be made, but do not write literal code.

You MUST NOT make any code changes or offer to make any code changes as part of this task. This task is purely to create a design document.

---

## ARCHITECTURAL REQUIREMENTS

- Must follow the repository coding guidelines.
- Must follow TDD methodology (tests before implementation).
- Must maintain 80% test coverage for new code.
- Must follow existing code patterns and conventions.
- Must handle all edge cases identified in requirements.

---

## STEPS

1. Read the specification in `specs/<slug>/specification.md`, where `<slug>` is a short kebab-case identifier for the feature or change.

2. Read and analyze the codebase to understand how the requirements can be implemented.
   - Do not rely solely on project overview knowledge.

3. If there are uncertainties:
   - Ask the user at most the **5 highest-impact clarifying questions**.
   - Only ask questions that block correct implementation or carry high risk.
   - Skip trivial questions.
   - If uncertainty is non-critical, make and document a sensible assumption.

4. Apply the **handoff-writing skill** to write the design-phase handoff, `specs/<slug>/design.md`.

5. Output a short summary to the chat (not the file):
   - assumptions made
   - clarifications received

6. Ask the user for feedback and integrate the feedback into the design document in a follow-up pass.

7. Do **not start implementation**. That's the implement phase, in a new session.
