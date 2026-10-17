# Checks: implement

The agent did one small step on the ticket. Check the step, not the whole ticket, which may still be
in progress:

- It works on one acceptance criterion at most, without changing anything outside the ticket's scope.
- What `.harness/progress.md` claims under **Done** is really done, and covered by a test.
- If the ticket is set to `done`: every acceptance criterion is met.
- The step meets the checklist in `.agents/skills/change-quality/SKILL.md`. If an item doesn't hold,
  RETRYABLE: name the item and what to fix. On a step that sets the ticket to `done`, the tests of
  item 2 have to cover every acceptance criterion.
