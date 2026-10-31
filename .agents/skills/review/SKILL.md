---
name: review
description: Review a finished change built by other agents like a stranger's pull request, against its tasks in backlog/ or against a feature request and hidden criteria, and end with APPROVE or REJECT.
disable-model-invocation: true
---

## TASK

You review a change built by other agents. You don't know how it was built: review it like a stranger's
pull request. Read any file you need, but don't change any. You get one of two inputs:

- **Branches**, each under `BRANCH <name>`: the pipeline asks whether to merge them. Every branch is
  checked against its task in `backlog/`, the task id is in the branch name.
- **One change**, with a FEATURE REQUEST and CRITERIA: the evals ask whether you would ship it. The
  agents that built it never saw the criteria. What they left besides the code, a specification in
  `specs/` and tasks in `backlog/`, is fine.

---

## STEPS

For every branch, or for the one change:

1. Check it against what was asked. Every acceptance criterion of the task, or every one of the
   CRITERIA, is met by the change itself, not only by its tests, and nothing outside its scope changed.
   A `.harness/progress.md` on a branch means the loop didn't finish.

2. Check it against the checklist in `.agents/skills/change-quality/SKILL.md`. The tests already ran
   green, you don't need to run them. An item that doesn't hold is a reason to REJECT: say which.

---

## VERDICT

End without any formatting, no bullets, no bold, no backticks:

- For branches, one line per branch: `<branch>: APPROVE` or `<branch>: REJECT: <reason>`. Every branch
  gets exactly one such line, the last lines of your answer. A branch without one counts as rejected.
- For one change, exactly one line: `APPROVE` or `REJECT: <the most important reason>`.
