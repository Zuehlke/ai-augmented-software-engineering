// The pipeline as `flows watch` draws it, the map of the Lab 12 diagram: four stages, each leaving a handoff for the
// next, and the boxes in them, one per role's agent, checkpoint or plain code, in order. A box covers one or more
// steps. A checkpoint can send its handoff back to an earlier box. Each box also says what it is on the command
// line: the page shows it when you hover over the box. To change the pipeline's picture, change this table.
import { MAX_RUNS } from '../config';
import type { Checkpoint, PipelineStep } from '../types/pipeline';

export const STAGES = [
  { name: 'Research', handoff: 'specs/<slug>/specification.md' },
  { name: 'Plan', handoff: 'specs/<slug>/design.md · backlog/' },
  { name: 'Implement', handoff: 'agent/<task>' },
  { name: 'Review', handoff: 'your branch' },
] as const;

export interface Box {
  stage: number; // in STAGES
  name: string;
  who: 'agent' | 'you' | 'code';
  role?: 'research' | 'design' | 'plan' | 'implement' | 'review'; // the agent's role, for its model
  runs?: number; // the most runs of its phase
  check?: string; // what checks its work; unset: nothing does
  steps: PipelineStep[];
  checkpoint?: Checkpoint | 'merge'; // where you decide
  sendsBackTo?: number; // a checkpoint you can send back: the box, in BOXES, that does it again
  sendsBack?: string; // what happens when you send it back
  many?: boolean; // one per task
  command: string; // what it is on the command line, one command per line; empty: it has none
  note: string; // what it does, in a sentence
}

export const BOXES: Box[] = [
  {
    stage: 0, name: 'Research', who: 'agent', role: 'research', runs: 3, check: 'judge', steps: ['researching'],
    command: 'flows start "<feature request>"',
    note: 'Starts the pipeline. The research agent writes the specification, its judge checks it',
  },
  {
    stage: 0, name: 'Specification', who: 'you', steps: ['waiting for your specification approval'], checkpoint: 'specification',
    sendsBackTo: 0, sendsBack: 'revise the specification',
    command: 'flows approve specification\nflows revise specification "<feedback>"',
    note: 'Approve it, or send it back: the research agent revises it',
  },
  {
    stage: 1, name: 'Design', who: 'agent', role: 'design', runs: 3, check: 'judge', steps: ['designing'],
    command: 'flows design --spec specs/<slug>/specification.md',
    note: 'In the pipeline it runs after you approved the specification. On its own, without a judge. It writes specs/<slug>/design.md next to the specification',
  },
  {
    stage: 1, name: 'Plan', who: 'agent', role: 'plan', runs: 3, check: 'judge', steps: ['planning'],
    command: 'flows plan --spec specs/<slug>/specification.md',
    note: 'In the pipeline it cuts the tasks along the design. On its own, without a judge',
  },
  {
    stage: 1, name: 'Plan', who: 'you', steps: ['waiting for your plan approval'], checkpoint: 'plan',
    sendsBackTo: 2, sendsBack: 'revise the plan · its tasks go, design and plan again',
    command: 'flows approve plan\nflows revise plan "<feedback>"',
    note: 'Approve it with its ready tasks, or send it back: its tasks go, design and plan again',
  },
  {
    stage: 2, name: 'Implement', who: 'agent', role: 'implement', runs: MAX_RUNS, check: 'tests, judge', steps: ['implementing'], many: true,
    command: 'flows ralph <task>\nflows ralph <task> --runs 1',
    note: 'One loop per task, each in its own worktree. The pipeline starts one per approved task',
  },
  {
    stage: 3, name: 'Review', who: 'agent', role: 'review', steps: ['reviewing'],
    command: 'flows merge',
    note: 'Runs inside the pipeline. flows merge waits for its verdicts',
  },
  {
    stage: 3, name: 'Merge', who: 'you', steps: ['waiting for your merge decision'], checkpoint: 'merge',
    command: 'flows merge',
    note: 'You decide whether to merge what the review approved',
  },
  {
    stage: 3, name: 'Merge', who: 'code', check: 'tests', steps: ['merging'],
    command: '',
    note: 'Plain code, no agent: rebases each approved branch onto yours, then runs the tests',
  },
];

// The box a step is in: BOXES.length once the pipeline is done
export function boxOf(step: PipelineStep): number {
  const i = BOXES.findIndex((box) => box.steps.includes(step));
  return i < 0 ? BOXES.length : i;
}
