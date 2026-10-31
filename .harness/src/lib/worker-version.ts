// Which harness code the worker runs. The worker restarts on a change in .harness/src only once no workflow
// runs anymore, so an evals run started right after a commit can run on the code before it. The worker notes the
// code it started with, file by file, and `flows evals` compares that with what your checkout has committed.
// Contents, not commits: committing what the worker already runs changes nothing, and needs no restart.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SRC = '.harness/src';

type Files = Record<string, string>; // path → git's hash of its content

const noteFile = () => path.join(process.env.FLOWS_STATE ?? path.join(os.homedir(), '.flows'), 'worker.harness');

const git = (repoDir: string, args: string[], input?: string) => execFileSync('git', args, { cwd: repoDir, encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });

// The files of the harness as the worker would load them now, in your working tree
function working(repoDir: string): Files {
  const listed = git(repoDir, ['ls-files', '--cached', '--others', '--exclude-standard', '--', SRC]).split('\n');
  const paths = listed.filter((p) => p && existsSync(path.join(repoDir, p)));
  if (!paths.length) return {};
  const hashes = git(repoDir, ['hash-object', '--stdin-paths'], paths.join('\n') + '\n').split('\n');
  return Object.fromEntries(paths.map((p, i) => [p, hashes[i]]));
}

// The files of the harness in the last commit
function committed(repoDir: string): Files {
  const files: Files = {};
  for (const line of git(repoDir, ['ls-tree', '-r', 'HEAD', '--', SRC]).split('\n')) {
    const match = /^\S+ blob (\S+)\t(.+)$/.exec(line);
    if (match) files[match[2]] = match[1];
  }
  return files;
}

// The worker calls this when it starts
export function noteWorkerVersion(repoDir: string): void {
  try {
    mkdirSync(path.dirname(noteFile()), { recursive: true });
    writeFileSync(noteFile(), JSON.stringify({ files: working(repoDir) }) + '\n');
  } catch {
    // not in a repository, or no state folder: then there's nothing to compare
  }
}

// Why the worker doesn't run the harness your checkout has committed, or null if it does or can't be told
export function staleWorker(repoDir: string): string | null {
  if (!existsSync(noteFile())) return null;
  let running: Files;
  let wanted: Files;
  try {
    const note = JSON.parse(readFileSync(noteFile(), 'utf8')) as { files?: Files };
    if (!note.files) return null; // a note of an older kind
    running = note.files;
    wanted = committed(repoDir);
  } catch {
    return null;
  }
  const differs = [...new Set([...Object.keys(running), ...Object.keys(wanted)])].filter((p) => running[p] !== wanted[p]).sort();
  if (!differs.length) return null;
  const shown = differs.slice(0, 5).map((p) => path.relative(SRC, p)).join(', ') + (differs.length > 5 ? `, and ${differs.length - 5} more` : '');
  return `The worker doesn't run the harness your checkout has committed (${shown} differ). The evals would name the wrong commit. The worker restarts once no workflow runs anymore and the code is committed: wait for that (flows logs), or stop the workflows.`;
}
