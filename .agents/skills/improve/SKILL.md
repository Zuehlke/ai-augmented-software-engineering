---
name: improve
description: After an evals run, read its results and the earlier ones, and propose changes to the skills and the harness for a human to make. Changes no file.
disable-model-invocation: true
---

## TASK

An evals run just ran the setup, the skills in `.agents/skills/` and the harness in `.harness/src/`, and
some runs weren't right the first time. Propose the changes to the setup that would prevent that next
time. A human reads your proposals and makes the ones they agree with. Read any file you need, but
don't change any.

---

## WHERE

- `.harness/evals/results/<id>/` of the evals named below:
  - an e2e evals run has `evals.json` and one `<task>-<run>.json` per run. `rejectedBecause` lists why a
    judge or a check rejected a step, `reason` why the run wasn't accepted.
  - a skill-loaded evals run has `skill-loaded-evals.json`: the cases whose skill loaded when it shouldn't, or didn't
    when it should.
- The folders next to it are the earlier evals, the oldest first. The `proposals` in their report is
  what was proposed then, and their `skillsCommit` and `harnessCommit` say what the setup was.

---

## HOW

1. Group the reasons of this evals. Look at the earlier ones too: a reason that comes back across runs,
   tasks or evals is a gap in the setup. One that shows up once can be chance: say so, and don't
   propose a change for it alone.
2. Check the earlier proposals: if one was made (`git log` since that evals) and its reason is gone,
   it helped. If the reason is still there, say so, and propose something else.
3. For each gap, find where the setup lets it happen: the skill the agent followed, the judge's checks,
   or the prompts in `.harness/src/workflows/prompts.ts`. Read the file.
4. Propose the smallest change that closes the gap, as a rule that holds for any feature request. Never
   a rule about one task's domain, its hidden tests or its criteria: the evals' tasks stand for all
   work, and a fix for one of them only games the evals.
5. For a skill-loaded evals run: a skill loads by its `description`. Propose a description that makes the failing
   cases pass without breaking the ones that pass, in the skill's `skill-loaded-evals.json`.

---

## OUTPUT

Markdown, at most five proposals, the one that would help most first. Each one:

```
## <what to change, in a few words>

**Why:** <the reason that kept coming back, in which runs, and since which evals>
**File:** <path>
**Change:** <the text to add or replace, as it would be in the file>
```

If nothing comes back often enough to be more than chance, say that in one line instead.
