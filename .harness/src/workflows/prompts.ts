// What the harness tells each agent. The work itself is in the skills, .agents/skills/<name>/SKILL.md, the
// same skills you use yourself in the earlier labs. This only adds what's different when nobody watches.
import type { PhaseName } from '../types/pipeline';

// Where an agent finds a skill, in its worktree
export const skillFile = (name: string) => `.agents/skills/${name}/SKILL.md`;

// The judge's checks for one phase. The judge reads only these, not the checks of the other phases.
export const judgeChecksFile = (phase: PhaseName) => `.agents/skills/judge/checks/${phase}.md`;

// What the research agent and its judge get: the feature request, and your feedback when you sent the
// specification back
export function researchInput(request: string, feedback?: string): string {
  const input = `Feature request: ${request}`;
  if (!feedback) return `${input}

Write the specification in a new folder, specs/<slug>/specification.md, with a slug no folder in specs/ has yet.`;
  return `${input}

Feedback from a human on the specification you wrote for it in specs/. Revise that specification.md and keep
what the feedback doesn't touch.

${feedback}`;
}

// What the design agent and its judge get: the specification, and your feedback when you sent the plan back
export function designInput(spec: string, feedback?: string): string {
  const input = `Specification: ${spec}`;
  if (!feedback) return input;
  return `${input}

Feedback from a human on the plan, the design and its tasks. Revise the design.md next to the specification
and keep what the feedback doesn't touch. Where the feedback is about how the work is cut into tasks, write
it down in the design too, for the plan agent.

${feedback}`;
}

// What the plan agent and its judge get: the specification with its design, and your feedback when you sent the
// plan back
export function planInput(spec: string, feedback?: string): string {
  const input = `Specification: ${spec}, with its design.md next to it`;
  if (!feedback) return input;
  return `${input}

A human sent the earlier tasks back with this feedback, and they were removed. Cut the tasks again:

${feedback}`;
}

// An agent that does the work, unattended
export function workPrompt(skill: PhaseName, input: string): string {
  return `Use the ${skill} skill in \`${skillFile(skill)}\` for the input below.

You run unattended: nobody answers questions or approves anything. Where the skill tells you to ask or to
wait for approval, make a sensible assumption, write it down where the skill keeps assumptions, and go on.
If \`.harness/run/feedback.md\` exists, the judge rejected your last run: fix what it says first.
Commit your work.

${input}`;
}

// The judge of a phase: it gets the same input as the agent, and the agent's commits
export function judgePrompt(phase: PhaseName, input: string, commits: string): string {
  return `Use the judge skill in \`${skillFile('judge')}\` to judge this ${phase} run, with the checks in \`${judgeChecksFile(phase)}\`.

${input}

${commits}`;
}

// The review agent of the pipeline: it gets every branch's changes, and decides which ones to merge
export function reviewPrompt(diffs: string): string {
  return `Use the review skill in \`${skillFile('review')}\` on the branches below.${diffs}`;
}

// The evals' grader: the same review skill, on the run's whole change, with the feature request and the task's
// hidden criteria. It decides whether you would ship it.
export function gradePrompt(request: string, criteria: string, change: string): string {
  return `Use the review skill in \`${skillFile('review')}\` on the change below.

FEATURE REQUEST

${request}

CRITERIA

${criteria}

CHANGE

${change}`;
}

// The improve agent: where the results of the evals that just ran are, the earlier ones are next to them
export function improvePrompt(kind: string, evalsId: string): string {
  return `Use the improve skill in \`${skillFile('improve')}\` on the ${kind} that just ran: its results are in \`.harness/evals/results/${evalsId}/\`.`;
}
