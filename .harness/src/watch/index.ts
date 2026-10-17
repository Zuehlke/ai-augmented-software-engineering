// `flows watch`: what runs, and what waits for you. Temporal and the worker run in the background (`task flows:start`),
// this only looks at them, and sends your decisions and answers to the workflows that wait for them.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client, Connection, WorkflowHandle } from '@temporalio/client';
import { collect } from './collect';
import type { Theme } from './grid';
import type { Need, Snapshot } from './model';
import { board, COLUMNS, needs } from './model';
import type { Agent } from '../shared';
import { branchOf, HARNESS_CODE, TASK_QUEUE } from '../shared';
import { discardBranch, mergeIntoYours, openDiff, previewMerge } from './merge';
import type { Ui } from './view';
import { nextView, render, views } from './view';
import { selectedCard, unmerged } from './view/board';
import type { EvalsChoice } from './view/evals';
import { evalsChoices, evalsKindOf, latestProposals, moveRun, selectedRun } from './view/evals';
import { listEvalsTasks } from '../activities/evals';
import { listSkillLoadedEvalCases } from '../activities/repo';
import { newEvalsId } from '../results';
import { staleWorker } from '../version';
import { answerSignal, approveTicketsSignal, decideMergeSignal } from '../workflows/signals';

const REFRESH = 1_500;

function currentBranch(repoDir: string): string | undefined {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
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

const same = (a: Need, b: Need) => a.kind === b.kind && a.workflowId === b.workflowId;

// Light or dark terminal, for the tints. FLOWS_THEME=light|dark decides, else the terminal's answer to
// "what's your background colour?" (OSC 11, VS Code and most terminals answer), else COLORFGBG, else dark.
async function detectTheme(): Promise<Theme> {
  const forced = process.env.FLOWS_THEME;
  if (forced === 'light' || forced === 'dark') return forced;
  const answer = await new Promise<string>((resolve) => {
    let data = '';
    const onData = (chunk: Buffer) => {
      data += chunk.toString('latin1');
      if (/rgb:[0-9a-f]+\/[0-9a-f]+\/[0-9a-f]+/i.test(data)) done();
    };
    const done = () => {
      clearTimeout(timer);
      process.stdin.off('data', onData);
      resolve(data);
    };
    const timer = setTimeout(done, 300);
    process.stdin.on('data', onData);
    process.stdout.write('\x1b]11;?\x07');
  });
  const rgb = /rgb:([0-9a-f]+)\/([0-9a-f]+)\/([0-9a-f]+)/i.exec(answer);
  if (rgb) {
    const [r, g, b] = rgb.slice(1).map((hex) => parseInt(hex, 16) / (16 ** hex.length - 1));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5 ? 'light' : 'dark';
  }
  const background = Number(process.env.COLORFGBG?.split(';').pop());
  return background === 7 || background === 15 ? 'light' : 'dark';
}

// `once`: prints one frame as plain text and returns, for scripts and when the output isn't a terminal
export async function watch(address: string, repoDir: string, once: boolean, agent: Agent): Promise<number> {
  let client = await connect(address);
  let snapshot: Snapshot = await collect(client, repoDir);
  const ui: Ui = { view: 'pipeline', need: 0, column: 0, scroll: [], cursor: [], stage: 0, tick: 0, branch: currentBranch(repoDir), agent };

  if (once || !process.stdout.isTTY || !process.stdin.isTTY) {
    // Without the empty rows a full screen would have
    console.log(render(snapshot, ui, process.stdout.columns || 126, process.stdout.rows || 40).plain().replace(/\n{3,}/g, '\n\n'));
    return 0;
  }

  const out = process.stdout;
  let theme: Theme = 'dark';
  const draw = () => out.write('\x1b[H' + render(snapshot, ui, out.columns, out.rows).ansi(theme));
  let messageTimer: NodeJS.Timeout | undefined;
  const say = (message: string) => {
    ui.message = message;
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => (ui.message = undefined), 6_000);
  };

  let busy = false;
  const refresh = async () => {
    if (busy) return;
    busy = true;
    try {
      client ??= await connect(address);
      snapshot = await collect(client, repoDir);
      if (!snapshot.temporal) client = undefined; // reconnect next time
      ui.branch = currentBranch(repoDir);
      if (!views(snapshot).includes(ui.view)) ui.view = 'pipeline'; // a branch without .harness/evals/: no Evals tab
      const all = needs(snapshot);
      ui.need = Math.min(ui.need, Math.max(0, all.length - 1));
      // Someone else decided (for example `flows start` in another terminal): close the dialog
      const shown = ui.dialog;
      if (shown && 'need' in shown && !all.some((need) => same(need, shown.need))) {
        ui.dialog = undefined;
        say('Already decided elsewhere.');
      }
    } finally {
      busy = false;
    }
  };

  // What every action does: run it, say how it went, close the dialog, show the new state
  const act = async (action: () => Promise<string>, failed: string) => {
    try {
      say(await action());
    } catch (err) {
      say(`${failed}: ${err instanceof Error ? err.message : err}`);
    }
    ui.dialog = undefined;
    await refresh();
    draw();
  };

  // Your decision or answer to a waiting workflow, the same as `flows start`, `flows merge` and `flows answer`
  const send = (workflowId: string, signal: (handle: WorkflowHandle) => Promise<void>, done: string) =>
    act(async () => {
      await signal(client!.workflow.getHandle(workflowId));
      return done;
    }, "Couldn't send it");

  // The same as `flows ralph <ticket> [--runs <n>] --detach`, `flows start "<request>"` and `flows plan --spec <file>`
  const start = (workflow: 'ralph' | 'pipeline' | 'plan' | 'evals' | 'skillLoadedEvals', workflowId: string, input: object, done: string) =>
    act(async () => {
      await client!.workflow.start(workflow, { taskQueue: TASK_QUEUE, workflowId, args: [{ repoDir, agent: ui.agent ?? agent, ...input }] });
      return done;
    }, "Couldn't start it");
  const startRalph = (ticket: string, maxRuns?: number) => {
    const done = maxRuns === 1 ? `Started one run of ralph-${ticket}.` : `Started ralph-${ticket}.`;
    return start('ralph', `ralph-${ticket}`, { ticket, maxRuns }, done);
  };
  const startPipeline = (request: string) => start('pipeline', 'pipeline', { request }, 'Started the pipeline.');
  const startPlan = (spec: string) => start('plan', 'plan', { spec }, 'Started the plan agent.');
  // The same as `flows evals [task] --yes`, or `flows skill-loaded-evals`
  const startEvals = (choice: EvalsChoice, cases: number) => {
    if (choice.skills && snapshot.skillLoadedEvals) return say('A skill-loaded evals is already running.');
    if (!choice.skills && snapshot.evals) return say('An evals run is already running.');
    const evalsId = newEvalsId();
    if (choice.skills) return start('skillLoadedEvals', `skill-loaded-evals-${evalsId}`, { evalsId }, `Started skill-loaded-evals-${evalsId}: ${cases * 3} runs.`);
    return start('evals', `evals-${evalsId}`, { evalsId, tasks: choice.tasks, runs: 3 }, `Started evals-${evalsId}: ${choice.tasks.length * 3} runs.`);
  };

  // s in the Evals tab: the evals of the sub-view you're in, the tasks or the skill-loaded evals, and what isn't committed, so the evals won't grade it
  const openStartEvals = async () => {
    if (!client) return say("Temporal isn't running.");
    const kind = evalsKindOf(snapshot, ui);
    if (kind === 'skillLoaded' && snapshot.skillLoadedEvals) return say('A skill-loaded evals is already running.');
    if (kind === 'e2e' && snapshot.evals) return say('An evals run is already running.');
    // The same check as `flows evals`: an evals run on a worker with other code would name the wrong commit
    const stale = kind === 'e2e' ? staleWorker(repoDir) : null;
    if (stale) return say(stale);
    try {
      const tasks = kind === 'e2e' ? await listEvalsTasks(repoDir) : [];
      const cases = kind === 'skillLoaded' ? await listSkillLoadedEvalCases(repoDir) : [];
      if (kind === 'e2e' && !tasks.length) return say('There are no evals tasks in .harness/evals/tasks/.');
      if (kind === 'skillLoaded' && !cases.length) return say('No skill has a skill-loaded-evals.json.');
      const status = execFileSync('git', ['status', '--porcelain', '--', '.agents', ...HARNESS_CODE], { cwd: repoDir, encoding: 'utf8' });
      const uncommitted = status.split('\n').filter(Boolean).map((line) => line.slice(3));
      const skills = kind === 'skillLoaded' ? { names: [...new Set(cases.map((c) => c.skill))], cases: cases.length } : undefined;
      ui.dialog = { kind: 'startEvals', tasks, cursor: 0, uncommitted, evalReports: snapshot.evalReports, skills, skillReports: snapshot.skillReports };
    } catch (err) {
      say(`Couldn't read the evals tasks: ${err instanceof Error ? err.message : err}`);
    }
    draw();
  };

  // ⏎ in the pipeline view: starts the phase that's selected
  const startPhase = () => {
    if (!client) return say("Temporal isn't running.");
    const running = snapshot.pipeline?.state === 'running';
    if (ui.stage <= 1) {
      if (running) return say('A pipeline is already running.');
      if (ui.stage === 0) {
        ui.dialog = { kind: 'request', text: '' };
      } else {
        // The plan agent takes a specification, like in the pipeline. The research agent writes it from a feature request.
        const specsDir = path.join(repoDir, 'specs');
        const entries = existsSync(specsDir) ? readdirSync(specsDir, { withFileTypes: true }) : [];
        const specs = entries.filter((e) => e.isDirectory()).map((e) => ({ id: `specs/${e.name}/specification.md`, title: '' }));
        if (!specs.length) return say('No specifications yet. Start the research agent first.');
        ui.dialog = { kind: 'pick', target: 'plan', items: specs, cursor: 0 };
      }
    } else if (ui.stage === 2) {
      const ready = snapshot.backlog.filter((t) => t.status === 'ready' && !snapshot.loops.some((l) => l.ticket === t.id && l.state === 'running'));
      if (!ready.length) return say('No ready tickets to implement.');
      ui.dialog = { kind: 'pick', target: 'ralph', items: ready.map((t) => ({ id: t.id, title: t.title })), cursor: 0 };
    } else {
      say(running ? 'Review and merge starts by itself after the implement loops.' : 'Review and merge only runs inside a pipeline.');
    }
  };

  // A failed workflow stays in Temporal's list and in "Needs you" until it's deleted
  const remove = (workflowId: string) =>
    act(async () => {
      await client!.workflowService.deleteWorkflowExecution({ namespace: 'default', workflowExecution: { workflowId } });
      return `Deleted ${workflowId}.`;
    }, "Couldn't delete it");

  // ⏎ on a card: the ticket's file, and from there what you can do with it
  const openTicket = () => {
    const card = selectedCard(snapshot, ui);
    if (!card) return false;
    const id = card.ticket.id;
    const dir = path.join(repoDir, 'backlog');
    const file = (existsSync(dir) ? readdirSync(dir) : []).find((name) => name.startsWith(`${id}-`) && name.endsWith('.md'));
    if (!file) {
      say(`backlog/ has no file for ${id} anymore.`);
      return true;
    }
    // What waits for you about this ticket: its approval, the judge's question, or its loop that failed
    const related = needs(snapshot).find((n) => {
      if (n.kind === 'approve') return n.tickets.includes(id);
      if (n.kind === 'answer') return n.ticket === id;
      if (n.kind === 'failed' || n.kind === 'stuck') return n.workflowId.endsWith(`-${id}`);
      return false;
    });
    const content = readFileSync(path.join(dir, file), 'utf8');
    ui.dialog = { kind: 'ticket', ticket: card.ticket, content, scroll: 0, start: card.column === 'Ready' && !!client, merge: unmerged(card), discard: discardable(id), related };
    return true;
  };

  // A loop of its own (`flows ralph`, not the pipeline's) or a branch left over from one: x throws it away
  const ownLoop = (ticket: string) => snapshot.loops.find((l) => l.ticket === ticket && l.workflowId === `ralph-${ticket}`);
  const commitsOf = (ticket: string) => {
    try {
      return Number(execFileSync('git', ['rev-list', '--count', `HEAD..${branchOf(ticket)}`], { cwd: repoDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
    } catch {
      return undefined; // no such branch
    }
  };
  const discardable = (ticket: string) => {
    if (snapshot.loops.some((l) => l.ticket === ticket && l.workflowId !== `ralph-${ticket}`)) return false;
    return !!ownLoop(ticket) || commitsOf(ticket) !== undefined;
  };

  // y in the discard dialog: deleting the loop from Temporal also stops it, then its worktree and branch go
  const discard = (ticket: string) =>
    act(async () => {
      const loop = ownLoop(ticket);
      if (loop && client) {
        const workflowExecution = { workflowId: loop.workflowId };
        await client.workflowService.deleteWorkflowExecution({ namespace: 'default', workflowExecution }).catch(() => {});
      } else if (loop?.state === 'running' || loop?.state === 'you') {
        throw new Error("Temporal isn't running, so the loop can't be stopped");
      }
      return discardBranch(repoDir, ticket);
    }, "Couldn't throw it away");

  // m in a ticket that isn't merged: shows what its branch brings, then rebases and fast-forwards it on y
  const openMerge = (ticket: { id: string; title: string }) => {
    try {
      ui.dialog = { kind: 'mergeBranch', preview: previewMerge(repoDir, ticket.id, ticket.title), into: ui.branch ?? 'the branch you\'re on' };
    } catch (err) {
      say(`Couldn't look at its branch: ${err instanceof Error ? err.message : err}`);
    }
  };

  const mergeBranch = (branch: string) => act(() => mergeIntoYours(repoDir, branch), "Couldn't merge it");

  const open = (need = needs(snapshot)[ui.need]) => {
    if (!need || !client) return;
    if (need.kind === 'approve') ui.dialog = { kind: 'approve', need, selected: new Set(), cursor: 0 };
    if (need.kind === 'merge') ui.dialog = { kind: 'merge', need };
    if (need.kind === 'answer') ui.dialog = { kind: 'answer', need, text: '' };
    if (need.kind === 'failed' || need.kind === 'stuck') ui.dialog = { kind: 'failed', need };
  };

  const key = (k: string) => {
    const d = ui.dialog;
    if (k === '\u0003' || (!d && k === 'q')) return quit();
    if (!d) {
      const count = needs(snapshot).length;
      if (k === '\t') {
        ui.view = nextView(snapshot, ui.view);
        if (ui.view === 'evals') ui.evalsTabs = true; // the Evals tab opens on its E2E / Skill loaded bar, ↓ goes to the runs
      }
      if (ui.view === 'evals') {
        // ←→ the runs in order, ↑↓ the rows, ⏎ the run's details, ↑ from the first row the E2E / Skill loaded bar. The view keeps the pick within the grids.
        const tabs = ui.evalsTabs;
        moveRun(snapshot, ui, k);
        const cell = tabs ? undefined : selectedRun(snapshot, ui);
        if (k === '\r' && cell?.kind === 'e2e') ui.dialog = { kind: 'evalsRun', run: cell.run };
        if (k === '\r' && cell?.kind === 'skill') ui.dialog = { kind: 'skillLoadedEvalRun', result: cell.result, run: cell.col + 1 };
        if (k === 's') void openStartEvals();
        if (k === 'p') {
          const sections = latestProposals(snapshot);
          if (sections.length) ui.dialog = { kind: 'proposals', sections, scroll: 0 };
          else say('The latest evals have no proposals: every run was right the first time.');
        }
      } else if (ui.view === 'board') {
        // ←→ jump to the next column that has tickets, to the one at the same height or the last
        const filled = COLUMNS.map((column, i) => (board(snapshot).some((c) => c.column === column) ? i : -1)).filter((i) => i >= 0);
        const next = k === '\x1b[C' ? filled.find((i) => i > ui.column) : k === '\x1b[D' ? [...filled].reverse().find((i) => i < ui.column) : undefined;
        if (next !== undefined) {
          const height = ui.cursor[ui.column] ?? 0;
          ui.column = next;
          ui.cursor[next] = Math.min(height, board(snapshot).filter((c) => c.column === COLUMNS[next]).length - 1);
        }
        if (k === '\x1b[B') ui.cursor[ui.column] = (ui.cursor[ui.column] ?? 0) + 1; // the view keeps it within the column
        if (k === '\x1b[A') ui.cursor[ui.column] = Math.max((ui.cursor[ui.column] ?? 0) - 1, 0);
        if (k === 's') {
          const card = selectedCard(snapshot, ui);
          if (card?.column === 'Ready' && client) ui.dialog = { kind: 'start', ticket: card.ticket.id, title: card.ticket.title };
          else say('Only a ready ticket can be started.');
        }
      } else {
        if (k === '\x1b[C') ui.stage = Math.min(ui.stage + 1, 3);
        if (k === '\x1b[D') ui.stage = Math.max(ui.stage - 1, 0);
        // The worker output: ↑ scrolls back, ↓ forward until it follows the new lines again, End follows at once
        if (k === '\x1b[A') ui.log = { lines: ui.log?.lines ?? snapshot.log, scroll: (ui.log?.scroll ?? 0) + 1 };
        if (k === '\x1b[B' && ui.log) ui.log = ui.log.scroll > 1 ? { ...ui.log, scroll: ui.log.scroll - 1 } : undefined;
        if (k === '\x1b[F' || k === '\x1b[4~' || k === '\x1b[8~') ui.log = undefined;
        if (k === '\r') startPhase();
      }
      if (k === 'a') ui.agent = ui.agent === 'copilot' ? 'claude' : 'copilot';
      if (k === 'n' && count) open();
      if (k === '\r' && ui.view === 'board') openTicket();
    } else if (k === '\x1b') {
      ui.dialog = undefined;
    } else if (!('cursor' in d) && (k === '\x1b[A' || k === '\x1b[B')) {
      // A dialog without a list scrolls when it's longer than the terminal. The view keeps it within the dialog.
      d.scroll = Math.max((d.scroll ?? 0) + (k === '\x1b[B' ? 1 : -1), 0);
    } else if (d.kind === 'request') {
      if (k === '\r' && d.text.trim()) void startPipeline(d.text.trim());
      else if (k === '\x7f' || k === '\b') d.text = [...d.text].slice(0, -1).join('');
      else if (!k.startsWith('\x1b')) d.text += [...k].filter((c) => c >= ' ').join('');
    } else if (d.kind === 'pick') {
      if (k === '\x1b[B') d.cursor = Math.min(d.cursor + 1, d.items.length - 1);
      if (k === '\x1b[A') d.cursor = Math.max(d.cursor - 1, 0);
      if (k === '\r') {
        const item = d.items[d.cursor];
        if (d.target === 'ralph') ui.dialog = { kind: 'start', ticket: item.id, title: item.title };
        else void startPlan(item.id);
      }
    } else if (d.kind === 'proposals') {
      // only scrolls, above
    } else if (d.kind === 'ticket') {
      if (k === '\r' && d.related) open(d.related);
      if (k === 'm' && d.merge) openMerge(d.ticket);
      if (k === 'd' && d.merge) say(openDiff(repoDir, branchOf(d.ticket.id)));
      if (k === 's' && d.start) ui.dialog = { kind: 'start', ticket: d.ticket.id, title: d.ticket.title };
      if (k === 'x' && d.discard) {
        const state = ownLoop(d.ticket.id)?.state;
        const running = state === 'running' || state === 'you';
        ui.dialog = { kind: 'discard', ticket: d.ticket.id, title: d.ticket.title, running, commits: commitsOf(d.ticket.id) ?? 0 };
      }
    } else if (d.kind === 'mergeBranch') {
      if (k === 'y' && d.preview.commits.length && !d.preview.conflicts) void mergeBranch(d.preview.branch);
      else if (k === 'd' && d.preview.commits.length) say(openDiff(repoDir, d.preview.branch));
      else if (k === 'n') ui.dialog = undefined;
    } else if (d.kind === 'start') {
      if (k === '1') void startRalph(d.ticket, 1);
      else if (k === 'y') void startRalph(d.ticket);
      else if (k === 'n') ui.dialog = undefined;
    } else if (d.kind === 'discard') {
      if (k === 'y') void discard(d.ticket);
      else if (k === 'n') ui.dialog = undefined;
    } else if (d.kind === 'approve') {
      const tickets = d.need.tickets;
      if (k === '\x1b[B') d.cursor = Math.min(d.cursor + 1, tickets.length - 1);
      if (k === '\x1b[A') d.cursor = Math.max(d.cursor - 1, 0);
      if (k === ' ' && tickets[d.cursor]) {
        const ticket = tickets[d.cursor];
        if (d.selected.has(ticket)) d.selected.delete(ticket);
        else d.selected.add(ticket);
      }
      if (k === '\r') {
        const approved = tickets.filter((t) => d.selected.has(t));
        void send(d.need.workflowId, (h) => h.signal(approveTicketsSignal, approved), `Approved: ${approved.join(' ') || 'none'}`);
      }
    } else if (d.kind === 'merge') {
      if (k === 'y' || k === 'n') void send(d.need.workflowId, (h) => h.signal(decideMergeSignal, k === 'y'), k === 'y' ? 'Merging.' : 'Not merged.');
    } else if (d.kind === 'answer') {
      if (k === '\r' && d.text.trim()) void send(d.need.workflowId, (h) => h.signal(answerSignal, d.text.trim()), 'Sent. The next run gets your answer.');
      else if (k === '\x7f' || k === '\b') d.text = [...d.text].slice(0, -1).join('');
      else if (!k.startsWith('\x1b')) d.text += [...k].filter((c) => c >= ' ').join('');
    } else if (d.kind === 'startEvals') {
      const choices = evalsChoices(d.tasks, d.skills);
      if (k === '\x1b[B') d.cursor = Math.min(d.cursor + 1, choices.length - 1);
      if (k === '\x1b[A') d.cursor = Math.max(d.cursor - 1, 0);
      if (k === '\r' && choices[d.cursor]) void startEvals(choices[d.cursor], d.skills?.cases ?? 0);
    } else if (d.kind === 'evalsRun' || d.kind === 'skillLoadedEvalRun') {
      if (k === '\r') ui.dialog = undefined;
    } else if (d.confirmDelete) {
      if (k === 'y') void remove(d.need.workflowId);
      else if (k === 'n') d.confirmDelete = false;
    } else if (k === 'd' && d.need.kind === 'failed') {
      d.confirmDelete = true;
    } else if (k === '\r') {
      ui.dialog = undefined;
    }
    draw();
  };

  const quit = () => {
    out.write('\x1b[0m\x1b[?25h\x1b[?1049l');
    process.exit(0);
  };

  process.stdin.setRawMode(true);
  theme = await detectTheme();
  out.write('\x1b[?1049h\x1b[?25l\x1b[2J');
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (data: string) => {
    // Keys come one at a time, pasted text all at once: arrows stay whole, the rest goes char by char
    for (const k of data.match(/\x1b\[[A-DFH]|\x1b\[\d+~|\x1b|[^]/gu) ?? []) key(k);
  });
  out.on('resize', () => {
    out.write('\x1b[2J');
    draw();
  });
  process.on('SIGTERM', quit);
  process.on('uncaughtException', (err) => {
    out.write('\x1b[0m\x1b[?25h\x1b[?1049l');
    console.error(err);
    process.exit(1);
  });

  draw();
  setInterval(() => void refresh().then(draw), REFRESH);
  setInterval(() => {
    ui.tick++;
    draw();
  }, 150);
  return new Promise<number>(() => {}); // runs until you quit
}
