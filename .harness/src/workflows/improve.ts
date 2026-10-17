import { isCancellation } from '@temporalio/workflow';
import type { Agent } from '../shared';
import { MODELS } from '../shared';
import { runAgent } from './activities';
import { failureMessage } from './failure';
import { improvePrompt } from './prompts';

// The improve agent reads the evals' results, and the earlier ones, and proposes changes to the skills and the
// harness. It only reads: the pipeline can't change those files, you make the ones you agree with. If it fails,
// the evals still counts, and the proposals say why there are none.
export async function propose(repoDir: string, agent: Agent, kind: string, evalsId: string): Promise<string> {
  try {
    const prompt = improvePrompt(kind, evalsId);
    const run = await runAgent({ repoDir, agent, mode: 'read', model: MODELS.improve, step: 'improve', prompt });
    return run.output.trim();
  } catch (err) {
    if (isCancellation(err)) throw err;
    return `The improve agent couldn't write proposals: ${failureMessage(err)}`;
  }
}
