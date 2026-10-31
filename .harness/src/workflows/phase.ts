import { ApplicationFailure, condition, log, setHandler } from '@temporalio/workflow';
import type { Agent } from '../config';
import { HARNESS_CODE, MAX_FAILURES, MODELS } from '../config';
import type { Changes, Phase, PhaseStatus, Verdict } from '../types/pipeline';
import { changesSince, headCommit, requireCommitted, resetTo, runAgent, setFeedback } from './support/activities';
import { judgeChecksFile, judgePrompt, skillFile, workPrompt } from './prompts';
import { answerSignal } from './signals';
import { parseVerdict } from './support/text';
import { count, rejected } from './support/usage';

// The agent does the work in workDir, a worktree, one run after the other, with the skill named like the
// phase. A separate judge checks each run, with the judge skill. The agent mustn't change the skills.
// The sandbox profile comes from repoDir, your checkout.
export async function runPhase(repoDir: string, workDir: string, agent: Agent, phase: Phase, status: PhaseStatus): Promise<void> {
  let answer: string | undefined;
  setHandler(answerSignal, (text) => void (answer = text));

  // Waits for your answer to the judge's question. Costs nothing meanwhile, for days if need be.
  const askHuman = async (question: string): Promise<string> => {
    answer = undefined; // only an answer to this question counts
    status.question = question;
    await condition(() => answer !== undefined);
    status.question = undefined;
    return answer!;
  };

  // The agents read the skills in their worktree, which only has what's committed
  await requireCommitted(repoDir, skillFile(phase.name));
  await requireCommitted(repoDir, skillFile('judge'));
  await requireCommitted(repoDir, judgeChecksFile(phase.name));
  if (phase.name === 'implement') await requireCommitted(repoDir, skillFile('change-quality'));
  let feedback: string | null = null; // what the next run learns about this one
  let verdict: Verdict | undefined;

  // A phase that is rejected MAX_FAILURES runs in a row is stuck: more runs won't help. A PASS resets the count.
  let failures = 0;

  try {
    for (let run = 1; run <= phase.maxRuns; run++) {
      status.run = run;
      await setFeedback(workDir, feedback); // .harness/run/feedback.md, the agent reads it first
      const before = await headCommit(workDir);
      const prompt = workPrompt(phase.name, phase.input);
      const work = await runAgent({ repoDir, workDir, agent, mode: 'write', model: MODELS[phase.name], step: phase.name, prompt });
      count(status, phase.name, work);

      status.judging = true; // `flows watch` lights up the judge
      try {
        verdict = await judge(repoDir, workDir, agent, phase, before, status);
      } finally {
        status.judging = false;
      }
      log.info(`== ${phase.name}: ${verdict.kind} ${verdict.reason}`);

      switch (verdict.kind) {
        case 'PASS': {
          if (!phase.done || (await phase.done())) return;
          failures = 0;
          if (run === phase.maxRuns) return; // out of runs, but the work so far is good: stop without an error
          feedback = null; // more to do: the next run takes the next step
          break;
        }
        case 'RETRYABLE':
          failures++;
          rejected(status, `${phase.name}: ${verdict.reason}`);
          feedback = `The judge rejected your work: ${verdict.reason}`;
          break;
        case 'AMBIGUOUS': // neither: the next run goes on with an assumption or your answer
          feedback = phase.unattended
            ? `The judge asked: ${verdict.reason}\nNobody answers: make a sensible assumption, write it down where the skill keeps assumptions, and go on.`
            : `The judge asked: ${verdict.reason}\nA human answered: ${await askHuman(verdict.reason)}`;
          break;
        case 'FAILED':
          throw ApplicationFailure.nonRetryable(verdict.reason);
      }
      if (failures >= MAX_FAILURES) {
        const last = `${verdict.kind} ${verdict.reason}`;
        throw ApplicationFailure.nonRetryable(`Stuck: ${failures} runs in a row rejected, after ${run} runs. The judge's last verdict: ${last}`);
      }
    }
    throw ApplicationFailure.nonRetryable(`Out of runs: ${phase.maxRuns} runs without a PASS. The judge's last verdict: ${verdict?.kind} ${verdict?.reason}`);
  } finally {
    await setFeedback(workDir, null); // the feedback was for this phase only
  }
}

// Plain code first: the rules below, then the phase's check (Ralph's: the tests). Only if they find
// nothing, the judge agent reads what the agent committed. It's slower, and it can be wrong.
async function judge(repoDir: string, workDir: string, agent: Agent, phase: Phase, before: string, status: PhaseStatus): Promise<Verdict> {
  const changes = await changesSince(workDir, before);
  const touched = changes.files.filter((file) => PROTECTED.some((p) => file.startsWith(p)));
  if (touched.length) {
    await resetTo(workDir, before);
    return { kind: 'RETRYABLE', reason: `you changed ${touched.join(', ')}, which you must not change. Your run was thrown away.` };
  }
  const broken = brokenRule(changes) ?? (phase.check ? await phase.check() : null);
  if (broken) return { kind: 'RETRYABLE', reason: broken };

  const prompt = judgePrompt(phase.name, phase.input, changes.commits);
  const run = await runAgent({ repoDir, workDir, agent, mode: 'read', model: MODELS.judge, step: `judge ${phase.name}`, prompt });
  const answer = count(status, 'judge', run);
  return parseVerdict(answer); // its last line: PASS, RETRYABLE: …, AMBIGUOUS: … or FAILED: …
}

// What the agent follows and gets judged by. It must not change it: a run that does is thrown away.
const PROTECTED = ['.agents/', '.harness/sandbox/', ...HARNESS_CODE, 'Taskfile.yml'];

// The judge's rules: what's broken about the run, or null
function brokenRule({ files, uncommitted }: Changes): string | null {
  if (!files.length) return "you didn't commit anything. Commit your work.";
  if (uncommitted.length) return `you left changes you didn't commit: ${uncommitted.join(', ')}. Commit them or remove them.`;
  return null;
}
