// `flows watch`: what runs, and what waits for you, as a page in your browser on http://localhost:8234. Temporal
// and the worker run in the background (`task flows:start`), this only looks at them every 1.5 seconds, and does
// what you decide on the page. The parts:
// - collect.ts reads Temporal, backlog/ and the worker's log into a snapshot
// - view-model.ts works out what it means: the box states, what needs you, the evals' marks
// - state.ts shapes it into the JSON the page draws, /api/state
// - actions.ts checks and does what you decide on the page, /api/action
// - public/: page.html, page.css, page.js, the page itself, no build step
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Client, Connection } from '@temporalio/client';
import { listEvalsTasks } from '../activities/evals';
import type { Agent } from '../config';
import { branchOf, TASK_QUEUE } from '../config';
import { staleWorker } from '../lib/worker-version';
import type { Repo, TaskView, Workflows } from './actions';
import { actions, BadAction, parseAction } from './actions';
import { collect } from './collect';
import { discardBranch, mergeIntoYours, openDiff } from './merge';
import type { Snapshot } from './view-model';
import type { PageState } from './state';
import { pageState } from './state';

const PORT = Number(process.env.FLOWS_WATCH_PORT ?? 8234);
const REFRESH = 1_500; // the page asks as often, see page.js
// How long one look at Temporal may take. Without it, a Temporal that stopped is noticed only after its client
// gave up retrying, about 20 seconds, and the page shows the old state meanwhile.
const DEADLINE = 3_000;

// The page's files, in public/, served as they are
const FILES: Record<string, [string, string]> = {
  '/': ['page.html', 'text/html; charset=utf-8'],
  '/page.css': ['page.css', 'text/css; charset=utf-8'],
  '/page.js': ['page.js', 'text/javascript; charset=utf-8'],
};

// What the server needs, so the tests can give it fakes
export interface Watch {
  state: () => PageState;
  task: (id: string) => TaskView | undefined;
  act: (body: string) => Promise<string>; // the POSTed action, as it came: act checks it
}

// The routes: the page, its state, a task's file, and your actions. Answers JSON, the page's files aside.
export function handler(watch: Watch): http.RequestListener {
  return async (req, res) => {
    const send = (code: number, body: string | object, type = 'application/json') => {
      res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      const file = FILES[url.pathname];
      if (req.method === 'GET' && file) return send(200, readFileSync(path.join(__dirname, 'public', file[0]), 'utf8'), file[1]);
      if (req.method === 'GET' && url.pathname === '/api/state') return send(200, watch.state());
      if (req.method === 'GET' && url.pathname === '/api/task') {
        const found = watch.task(url.searchParams.get('id') ?? '');
        return found ? send(200, found) : send(404, { message: 'No such task in backlog/.' });
      }
      if (req.method === 'POST' && url.pathname === '/api/action') {
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 100_000) return send(413, { message: 'The action is too long.' });
        }
        return send(200, { message: await watch.act(body) });
      }
      send(404, { message: 'Not found' });
    } catch (err) {
      // An action that isn't right is yours to fix, anything else is a bug or Temporal saying no
      send(err instanceof BadAction ? 400 : 500, { message: err instanceof Error ? err.message : String(err) });
    }
  };
}

export async function watch(address: string, repoDir: string, agent: Agent): Promise<number> {
  let client = await connect(address);
  let snapshot: Snapshot = await collect(client, repoDir);
  let evalTasks: string[] = [];
  let busy = false;
  const refresh = async () => {
    if (busy) return;
    busy = true;
    try {
      client ??= await connect(address);
      const look = client;
      snapshot = look ? await look.withDeadline(Date.now() + DEADLINE, () => collect(look, repoDir)).catch(() => collect(undefined, repoDir)) : await collect(undefined, repoDir);
      evalTasks = (await listEvalsTasks(repoDir).catch(() => [])).map((t) => t.id);
      if (!snapshot.temporal && client) {
        await client.connection.close().catch(() => {});
        client = undefined; // connect again next time, once Temporal is back
      }
    } catch (err) {
      // The page keeps the last snapshot, and the next refresh tries again
      console.error(`flows watch couldn't read the state: ${err instanceof Error ? err.message : err}`);
    } finally {
      busy = false;
    }
  };
  setInterval(() => void refresh(), REFRESH);

  // Temporal, as the actions need it. Without it, an action says so.
  const temporal = () => {
    if (!client) throw new Error("Temporal isn't running. Start it and the worker: task flows:start");
    return client;
  };
  const workflows: Workflows = {
    start: async (workflow, workflowId, input) => void (await temporal().workflow.start(workflow, { taskQueue: TASK_QUEUE, workflowId, args: [input] })),
    signal: (workflowId, signal, ...args) => temporal().workflow.getHandle(workflowId).signal(signal, ...args),
    remove: async (workflowId) => void (await temporal().workflowService.deleteWorkflowExecution({ namespace: 'default', workflowExecution: { workflowId } })),
  };
  const repo: Repo = {
    discardBranch: (task) => discardBranch(repoDir, task),
    mergeIntoYours: (branch) => mergeIntoYours(repoDir, branch),
    openDiff: (branch) => openDiff(repoDir, branch),
    hasBranch: (task) => git(repoDir, 'rev-parse', '--verify', '--quiet', branchOf(task)) !== undefined,
    evalTasks: () => listEvalsTasks(repoDir),
    staleWorker: () => staleWorker(repoDir),
  };
  const page = actions(repoDir, () => snapshot, workflows, repo, agent);

  const server = http.createServer(handler({
    state: () => pageState(snapshot, git(repoDir, 'rev-parse', '--abbrev-ref', 'HEAD'), page.agent(), evalTasks),
    task: page.task,
    act: (body) => page.act(parseAction(body)),
  }));
  server.listen(PORT, () => {
    console.log(`flows watch: http://localhost:${PORT}`);
    console.log('Open it in your browser. In GitHub Codespaces, open the Ports tab and the globe next to port 8234. Ctrl+C stops it.');
  });
  return new Promise<number>(() => {}); // runs until you stop it
}

// A git command's output, or undefined when it fails
function git(repoDir: string, ...args: string[]): string | undefined {
  try {
    return execFileSync('git', args, { cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return undefined;
  }
}

async function connect(address: string): Promise<Client | undefined> {
  try {
    return new Client({ connection: await Connection.connect({ address, connectTimeout: 2_000 }) });
  } catch {
    return undefined;
  }
}
