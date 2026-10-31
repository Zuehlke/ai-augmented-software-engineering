// Pure string helpers for the workflows (no I/O, so they are deterministic)
import type { Verdict } from '../../types/pipeline';

// Every agent that judges ends its answer with a verdict line: a keyword, then the reason. For example
// `RETRYABLE: add a test` from a judge, `REJECT: <reason>` from the evals' grader. The pipeline's review puts the
// branch in front: `agent/task-5: REJECT: <reason>`. This finds the last such line, so the agent can think out
// loud before it. Undefined if there is none.
export function findVerdict<K extends string>(answer: string, keywords: readonly K[], subject?: string): { kind: K; reason: string } | undefined {
  const prefix = subject ? `${subject.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*` : '';
  const pattern = new RegExp(`^${prefix}(${keywords.join('|')})\\b[\\s:,]*(.*)$`);
  for (const line of answer.split('\n').reverse()) {
    const match = pattern.exec(line.trim()) ?? pattern.exec(unformatted(line));
    if (match) return { kind: match[1] as K, reason: match[2].trim() };
  }
  return undefined;
}

// A verdict line the agent wrapped in markdown anyway: `**agent/task-1: APPROVE**`, `- agent/task-1: REJECT, …`
function unformatted(line: string): string {
  return line.trim().replace(/^[\s>*`-]+/, '').replace(/[*`]+$/, '').trim();
}

// The review's verdict lines, one per branch, as it wrote them: `agent/task-1: REJECT, <why>`.
export function branchVerdicts(review: string): string[] {
  const last = new Map<string, string>();
  for (const line of review.split('\n').map(unformatted)) {
    const match = /^([\w./-]+):\s*(APPROVE|REJECT)\b/.exec(line);
    if (match) last.set(match[1], line);
  }
  return [...last.values()];
}

// The judge's verdict. No verdict counts as RETRYABLE, so the agent simply tries again.
export function parseVerdict(answer: string): Verdict {
  return findVerdict(answer, ['PASS', 'RETRYABLE', 'AMBIGUOUS', 'FAILED'] as const) ?? { kind: 'RETRYABLE', reason: 'the judge gave no verdict' };
}
