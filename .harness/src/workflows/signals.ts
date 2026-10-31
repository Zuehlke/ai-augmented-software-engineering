// How you talk to a running workflow. A query asks what it's doing, a signal sends it your decision.
// The workflows handle them, the CLI and `flows watch` send them.
import { defineQuery, defineSignal } from '@temporalio/workflow';
import type { Checkpoint, DesignStatus, PhaseStatus, PipelineStatus, PlanStatus, RalphStatus } from '../types/pipeline';
import type { EvalsStatus } from '../types/evals';
import type { SkillLoadedEvalsStatus } from '../types/skill-loaded-evals';

// Every workflow answers `status`. What they all have: the run, and the judge's question while it waits for you.
export const statusQuery = defineQuery<PhaseStatus>('status');
export const designStatus = defineQuery<DesignStatus>('status');
export const planStatus = defineQuery<PlanStatus>('status');
export const ralphStatus = defineQuery<RalphStatus>('status');
export const pipelineStatus = defineQuery<PipelineStatus>('status');
export const evalsStatus = defineQuery<EvalsStatus>('status');
export const skillLoadedEvalsStatus = defineQuery<SkillLoadedEvalsStatus>('status');

// Your answer to the judge's question: `flows answer`
export const answerSignal = defineSignal<[string]>('answer');

// The pipeline's checkpoints: the specification you approve, the plan you approve with the tasks you hand over
// (`flows start`, `flows approve`), either one you send back with your feedback (`flows revise`), and whether to
// merge (`flows merge`)
export const approveSpecificationSignal = defineSignal('approveSpecification');
export const approveTasksSignal = defineSignal<[string[]]>('approveTasks');
export const reviseSignal = defineSignal<[Checkpoint, string]>('revise');
export const decideMergeSignal = defineSignal<[boolean]>('decideMerge');
