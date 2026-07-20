---
name: research
description: Critically review a requirement, surface gaps, refine requirements, and write an improved spec.
# TODO: Make the skill invocable only by the user, not by other agents.
---

## TASK

// TODO: Describe the task

---

## STEPS

1. Analyze the requirement based on the user’s prompt to make sure you understand it.
    - If necessary, read targeted parts of the codebase to understand current behavior from a user perspective.

2. Detect and list gaps or ambiguities (missing acceptance criteria, unclear ownership, implicit assumptions, vague terms, hidden dependencies, sequencing conflicts).

3. Ask the user at most the 5 highest-impact clarifying questions (only those that block correct implementation or carry high risk). Use the #askQuestions tool. Skip trivial questions.
    - If something is uncertain but non-critical, make and state a sensible assumption instead of asking.

4. Draft improved, implementation-ready requirements:
    - Context (1–2 sentences)
    - Objective (single clear outcome)
    - Acceptance Criteria (testable, numbered)
    - Non-Functional Requirements / Constraints (if any)
    - Risks / Mitigations (optional if any material ones)

5. Apply the **handoff-writing skill** to persist the refined specification:
    - Write the refine-phase handoff using the structure defined in `handoff-writing.md`.

6. Output a short summary to the chat (not the file):
    - assumptions made
    - clarifications received

7. Ask the user for feedback and incorporate it into the handoff document in a follow-up pass.

---

## ASPECTS TO CONSIDER FOR API DESIGN

- What should the endpoint URLs be?
- What parameters should they accept?
- What response format should they return?
- What HTTP status codes should be used for different scenarios?
- How should this feature align with existing endpoints?
- What naming conventions should be followed?
- What response format patterns should be maintained?
- Are there any mathematical edge cases (e.g., division by zero, overflow)?

---

## PRIORITIZATION RULES

- Favor clarity over completeness; remove noise.
- Reject scope creep: if not traceable to the stated objective, ask the user for clarification.
- Ensure each acceptance criterion is objectively testable.
- Avoid solution bias unless mandated by constraints.

---

## ADDITIONAL RULES

If the user’s prompt is fundamentally insufficient, refuse to review it and ask the user to provide at least a minimal set of requirements.