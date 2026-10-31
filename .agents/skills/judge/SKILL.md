---
name: judge
description: Judge another agent's run on a phase (research, design, plan or implement) like a stranger's work, and end with one verdict line.
disable-model-invocation: true
---

## TASK

Another agent just did a run on the phase named below, for the input below. Its commits are at the
end. Judge them like a stranger's work. Read any file you need, but don't change any.

---

## CHECKS

Read the checks of the phase you judge, and only those: `checks/<phase>.md` next to this file, for
example `checks/implement.md`. The phase is named below.

---

## VERDICT

End with exactly one line, without any formatting: `PASS`, `RETRYABLE: <what to fix>`,
`AMBIGUOUS: <question for a human>` or `FAILED: <why no further attempt can fix it>`.
