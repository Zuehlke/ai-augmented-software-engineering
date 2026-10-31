---
name: implement
description: Take one small step on a task in backlog/, one acceptance criterion per run, tested and committed, with .harness/progress.md as the memory between runs.
disable-model-invocation: true
---

## TASK

You work on one task in `backlog/`, one small step per run. You don't remember earlier runs:
`.harness/progress.md`, `.harness/learnings.md` and the git history are your memory.

---

## STEPS

1. Read `.harness/run/feedback.md`, `.harness/progress.md` and `.harness/learnings.md` (if they exist)
   and `git log --oneline -10`. If the task names a `design:`, read it: follow its decisions.

2. If `.harness/run/feedback.md` exists, the judge found a problem with your last step: fix that.
   Otherwise pick the first acceptance criterion in the task that isn't under Done, write it in
   `.harness/progress.md` before you write any code, and build only what its test needs. Code or a test
   that another criterion needs is out of this step, even if it is one line. If feedback says a step did
   too much, keep its tested work, record each criterion it meets under Done, and don't delete tests or
   harness files to make the step smaller.

3. Write the tests with the change, following the testing skill in `.agents/skills/testing/SKILL.md`.
   For each acceptance criterion, name the test that covers it in `.harness/progress.md`.
   Before you commit, for each rule or branch this step adds: swap in the simplest wrong version of it,
   run the test you named for it, and see it fail. Then put the real code back. If no test can fail for it, delete
   it: it belongs to the step of the criterion that asks for it.
   For every input this step reads, write in `.harness/progress.md` the test for each case the testing
   skill lists for it. Don't set a task to `done` while a listed case has no test.

4. Run `task format`, then `task test`. If the tests fail, fix them before you continue.

5. Check your step against the checklist in `.agents/skills/change-quality/SKILL.md`, and fix what
   doesn't hold: the judge and the review check the same list.

6. Update `.harness/progress.md`, in the format of `.agents/skills/handoff-writing/templates/progress.md`.

7. If your step met the last open acceptance criterion: copy the decisions that later tasks need to
   know to `.harness/learnings.md`, one line each, delete `.harness/progress.md`, and only then set the
   task's `status` to `done`. A done task with a `.harness/progress.md` is rejected.

8. Commit everything in exactly one commit. Then stop, even if criteria are still open: the next run
   does the next step. Don't push.
