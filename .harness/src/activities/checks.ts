import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { TestResult } from '../types/pipeline';
import { exec, git } from './exec';

// Activities that check the agents' work in plain code, before a judge does: the tests, and the rules of the
// research and the design phase. And the feedback file the next run reads first.

// What a run leaves for the next one, not part of the work: .harness/run/, ignored by git
async function runFile(repoDir: string, name: string): Promise<string> {
  const dir = path.join(repoDir, '.harness/run');
  await mkdir(dir, { recursive: true });
  return path.join(dir, name);
}

// Writes .harness/run/feedback.md for the next agent run, or removes it (feedback = null)
export async function setFeedback(repoDir: string, feedback: string | null): Promise<void> {
  const file = await runFile(repoDir, 'feedback.md');
  if (feedback === null) {
    await rm(file, { force: true });
  } else {
    await writeFile(file, feedback + '\n');
  }
}

// The whole output goes to .harness/run/test-output.txt, the judge only gets its end
export async function runTests(repoDir: string): Promise<TestResult> {
  const { code, output } = await exec(repoDir, 'task', ['test'], { quiet: true });
  await writeFile(await runFile(repoDir, 'test-output.txt'), output);
  return { pass: code === 0, tail: output.slice(-3_000) };
}

// The design phase's rule: what's broken about its work since `before`, or null. It writes one
// specs/<slug>/design.md, and changes nothing outside specs/.
export async function designProblem(workDir: string, before: string, spec: string): Promise<string | null> {
  const design = spec.replace(/[^/]*$/, 'design.md');
  const files = (await git(workDir, 'diff', '--name-only', before, 'HEAD')).split('\n').filter(Boolean);
  const outside = files.filter((file) => !file.startsWith('specs/'));
  if (outside.length) return `the design changes no code, but you changed ${outside.join(', ')}. Undo those changes.`;
  const others = files.filter((file) => file !== design);
  if (others.length) return `the design goes into ${design} only, but you changed ${others.join(', ')}. Undo those changes.`;
  if (!files.includes(design)) return `you didn't write the design. Write it next to the specification, in ${design}.`;
  return null;
}

// The research phase's rule: the specification it wrote since `before`, or what's wrong. It writes one
// specs/<slug>/specification.md, a new one, and changes nothing outside specs/. When it revises the specification you
// sent back, `revising` is that one: it changes it, and no other.
export async function specificationOf(workDir: string, before: string, revising?: string): Promise<{ spec?: string; problem?: string }> {
  const changed = (await git(workDir, 'diff', '--name-only', before, 'HEAD')).split('\n').filter(Boolean);
  const added = (await git(workDir, 'diff', '--name-only', '--diff-filter=A', before, 'HEAD')).split('\n').filter(Boolean);
  const outside = changed.filter((file) => !file.startsWith('specs/'));
  if (outside.length) return { problem: `the research changes no code, but you changed ${outside.join(', ')}. Undo those changes.` };
  const specs = changed.filter((file) => /^specs\/[^/]+\/specification\.md$/.test(file));
  if (revising) {
    const others = specs.filter((file) => file !== revising);
    if (others.length) return { problem: `revise ${revising}, not ${others.join(', ')}. Undo those changes.` };
    return specs.length ? { spec: revising } : { problem: `you didn't revise ${revising}. Revise it with the feedback.` };
  }
  if (!specs.length) return { problem: "you didn't write the specification. Write it in specs/<slug>/specification.md." };
  if (specs.length > 1) return { problem: `you wrote more than one specification: ${specs.join(', ')}. Write one.` };
  if (!added.includes(specs[0])) return { problem: `${specs[0]} was already there, from earlier work. Pick a new slug for this feature request.` };
  return { spec: specs[0] };
}

// True while .harness/progress.md is there: the loop's memory, which it deletes when the task is done
export async function progressLeft(workDir: string): Promise<boolean> {
  return existsSync(path.join(workDir, '.harness/progress.md'));
}
