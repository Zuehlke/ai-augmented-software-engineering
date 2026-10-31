---
name: change-quality
description: The checklist a change has to meet, used by the agent that makes it before it commits, and by the judge, the review and the evals grader that check it.
disable-model-invocation: true
---

## CHECKLIST

A change is right when all four hold. Whoever checks it, the agent before it commits, the judge after a
step, the review at the end, uses these items and names the one that doesn't hold.

1. **Scope.** The change does what the task asks, and nothing it doesn't ask for: no extra behaviour,
   options or rules, nothing changed outside the task.

2. **Tests.** Every acceptance criterion done so far has a test that fails without the change. A test that
   only passes because it mirrors the code doesn't count. For an endpoint, the cases of the testing skill in
   `.agents/skills/testing/SKILL.md` are covered, each new parameter on its own and together with the others.

3. **No shortcuts.** Nothing is hard-coded to the test data, no test is disabled, deleted or weakened, and no
   behaviour of an existing endpoint changed unless the task asks for it.

4. **Fit.** The code follows the codebase around it: its structure, its naming, its error handling, and in the
   tests the style of the existing ones. It only uses libraries the build file declares. Where a plain, usual
   way gives the same behaviour, the fragile or unusual one doesn't pass.
