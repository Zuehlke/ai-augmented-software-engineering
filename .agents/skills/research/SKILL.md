---
name: research
description: "Turn a feature request into a specification in specs/: find its gaps, ask about the ones that matter, and write testable acceptance criteria. Changes no code."
disable-model-invocation: true
---

## TASK

You are exploring and refining a requirement and writing an improved specification. Be concise, critical, and pragmatic.

The specification describes how the change should behave from an API/user perspective, without implementation details it doesn't need.

The specification is written for both a human (for further refinement) and a coding agent (for implementation).

Don't change any code, and don't offer to: this task only refines the requirement.

---

## STEPS

1. Analyze the requirement in the feature request to make sure you understand it.
   - If necessary, read targeted parts of the codebase to understand current behavior from a user perspective.

2. Detect and list gaps or ambiguities (missing acceptance criteria, unclear ownership, implicit assumptions, vague terms, hidden dependencies, sequencing conflicts).

3. Ask the user at most the 5 highest-impact clarifying questions (only those that block correct implementation or carry high risk). Skip trivial questions.
   - If something is uncertain but non-critical, make and state a sensible assumption instead of asking.
   - An assumption only settles what the request leaves open. It never changes a value the request
     defines: no rounding, truncation, clamping, default or reformatting that the request doesn't name.
     If the exact value seems impractical, list it under Risks and keep it exact.

4. Draft improved, implementation-ready requirements:
   - Title: the outcome, from the user's perspective
   - Context (1–2 sentences)
   - Acceptance Criteria (objectively testable, false at the current commit). A coding agent only does what a
     criterion names, so name each input case: for every parameter the change adds, missing or blank,
     invalid, valid, combined with each existing parameter, and unchanged behaviour when it is absent.
   - Constraints, Non-goals, Assumptions and Risks (if any)

5. Use the handoff-writing skill to write the research-phase handoff, `specs/<slug>/specification.md`.

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

If the feature request is too thin to specify, don't write a specification: ask for at least a minimal set of requirements.
