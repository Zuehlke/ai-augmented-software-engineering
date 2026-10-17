---
# TODO: Write frontmatter
---

## TASK

You are implementing a design. You must follow the design document and work until all specified changes are implemented.

Your work is only done when:
- All acceptance criteria are met
- All tests (new and existing) pass successfully
- There are no quality check errors
- The code is properly formatted

---

## STEPS

1. Read the specification in `specs/<slug>/specification.md` to understand the acceptance criteria from a user perspective, where `<slug>` is a short kebab-case identifier for the feature or change.

2. Read the design in `specs/<slug>/design.md` to understand the implementation details.

3. If `.harness/progress.md` exists, an earlier session already started: continue from there, don't start over.

4. Implement the changes using TDD (tests before implementation).

5. Each time an acceptance criterion is met, apply the **handoff-writing skill** to update the implement-phase handoff, `.harness/progress.md`, so a new session could continue from it.

6. Iterate until all acceptance criteria are met and all test cases succeed.
   - YOU MUST NOT STOP until all quality checks succeed.

7. When every acceptance criterion is met, delete `.harness/progress.md`: the work is done, and the
   decisions are in the code and its commits.

8. Update any further documentation such as `README.md` to reflect any changes in usage or behavior.

---

## CONSTRAINTS

- Run tests after each logical unit of work.
- Do not skip tests — every piece of functionality must be tested.
- Do not deviate from the design without explicit approval. Record every approved deviation under **Decisions** in `.harness/progress.md`.
- Maintain all existing functionality — no breaking changes.
- Follow TDD methodology rigorously.
