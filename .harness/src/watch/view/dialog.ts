// The dialogs over the tabs: what you decide, answer, start or read in `flows watch`
import { BOLD, DIM, Grid, LINE, Style, wrap, YOU } from '../grid';
import type { Need, Ticket } from '../model';
import { verdicts } from '../model';
import type { MergePreview } from '../merge';
import { estimate, estimateSkills, estimateText } from '../../results';
import { branchOf, dollars, worktreeName } from '../../shared';
import { MAX_RUNS } from '../../types/pipeline';
import type { EvalsReport, EvalsRun, EvalsTask } from '../../types/evals';
import type { SkillLoadedEvalReport, SkillLoadedEvalResult } from '../../types/skill-loaded-evals';
import { asExpected } from '../../types/skill-loaded-evals';
import { actionOf, scrollWindow } from './common';
import type { Proposals } from './evals';
import { evalsChoices } from './evals';
import { markdown } from './markdown';

// `scroll`: the first line shown of a dialog too long for the terminal; `list`: the first item shown of a long list in it
export type Dialog = (
  | { kind: 'approve'; need: Extract<Need, { kind: 'approve' }>; selected: Set<string>; cursor: number }
  | { kind: 'merge'; need: Extract<Need, { kind: 'merge' }> }
  | { kind: 'answer'; need: Extract<Need, { kind: 'answer' }>; text: string }
  | { kind: 'failed'; need: Extract<Need, { kind: 'failed' | 'stuck' }>; confirmDelete?: boolean }
  | { kind: 'start'; ticket: string; title: string } // a ready ticket picked on the board or in the pipeline
  | { kind: 'discard'; ticket: string; title: string; running: boolean; commits: number } // a loop's work, to throw away
  | { kind: 'mergeBranch'; preview: MergePreview; into: string } // a finished loop's branch, picked on the board
  // A ticket's file, opened on the board, with what you can do with it from there
  | { kind: 'ticket'; ticket: Ticket; content: string; scroll: number; start: boolean; merge: boolean; discard?: boolean; related?: Need }
  | { kind: 'request'; text: string } // the feature request that starts the pipeline
  | { kind: 'pick'; target: 'ralph' | 'plan'; items: { id: string; title: string }[]; cursor: number } // a ready ticket for an implement loop, or a specification for the plan agent
  | { kind: 'evalsRun'; run: EvalsRun } // a run of the latest evals, picked in the Evals tab
  | { kind: 'skillLoadedEvalRun'; result: SkillLoadedEvalResult; run: number } // a run of a case of the latest skill-loaded evals
  | { kind: 'proposals'; sections: Proposals[]; scroll: number } // p in the Evals tab: what the improve agent proposes
  // s in the Evals tab: all tasks or one in E2E, the skill-loaded evals in Skill loaded, what that will cost, and what isn't committed so the evals doesn't grade it
  | { kind: 'startEvals'; tasks: EvalsTask[]; cursor: number; uncommitted: string[]; evalReports: EvalsReport[]; skills?: SkillChoice; skillReports?: SkillLoadedEvalReport[] }
) & { scroll?: number; list?: number };

// The skill-loaded evals in the start dialog: the skills that have a skill-loaded-evals.json, and how many cases they have
export interface SkillChoice {
  names: string[];
  cases: number;
}

// One kind of dialog, for example DialogOf<'merge'>
type DialogOf<K extends Dialog['kind']> = Extract<Dialog, { kind: K }>;

// A dialog as it's built: its title, its lines, and the keys at the bottom
interface Content {
  width: number; // the width of its text
  rows: number; // the terminal's, for how many items of a list fit
  title: string;
  body: [string, Style][];
  keys: [string, string][];
  focus?: number; // the line of the picked item of a list, which stays in view
}

// The picked item of a list
const PICKED: Style = { bold: true, bg: 'selected' };

// Below the stage cards when it fits there (`below`), else in the middle
export function dialog(g: Grid, d: Dialog, titles: Map<string, string>, below: number): void {
  const width = Math.min(80, g.width - 4);
  const c: Content = { width: width - 6, rows: g.height, title: '', body: [], keys: [] };
  switch (d.kind) {
    case 'request': request(c, d); break;
    case 'pick': pick(c, d); break;
    case 'evalsRun': evalsRun(c, d); break;
    case 'skillLoadedEvalRun': skillLoadedEvalRun(c, d); break;
    case 'startEvals': startEvals(c, d); break;
    case 'start': start(c, d); break;
    case 'discard': discard(c, d); break;
    case 'proposals': proposals(c, d); break;
    case 'ticket': ticket(c, d); break;
    case 'mergeBranch': mergeBranch(c, d); break;
    case 'approve': approve(c, d, titles); break;
    case 'merge': merge(c, d); break;
    case 'answer': answer(c, d); break;
    case 'failed': failed(c, d); break;
  }
  frame(g, d, c, width, below);
}

// A paragraph, wrapped to the dialog's width
function paragraph(c: Content, text: string, style: Style = {}): void {
  for (const line of wrap(text, c.width)) c.body.push([line, style]);
}

function blank(c: Content): void {
  c.body.push(['', {}]);
}

// A long list: as many items as fit next to the rest of the dialog, the picked one in view, how many more above and below
function list(c: Content, d: Dialog, items: [string, Style][], cursor: number): void {
  const rows = Math.min(12, Math.max(3, c.rows - 20));
  if (items.length <= rows) {
    c.focus = c.body.length + cursor;
    c.body.push(...items);
    return;
  }
  const shown = rows - 2;
  const first = scrollWindow(items.length, shown, cursor, d.list);
  d.list = first;
  const after = items.length - first - shown;
  c.body.push([first ? `   ↑ ${first} more` : '', DIM]);
  c.focus = c.body.length + cursor - first;
  c.body.push(...items.slice(first, first + shown));
  c.body.push([after ? `   ↓ ${after} more` : '', DIM]);
}

// The frame, the lines that fit, and the keys. Too long for the terminal: as many lines as fit, from where you
// scrolled to, or around the picked item of a list. The view keeps the scroll within the dialog.
function frame(g: Grid, d: Dialog, { width: inner, title, body, keys, focus }: Content, width: number, below: number): void {
  const height = Math.min(body.length + 5, g.height - 2);
  const visible = Math.max(1, height - 5);
  d.scroll = scrollWindow(body.length, visible, focus ?? d.scroll ?? 0, d.scroll);
  if (body.length > visible && focus === undefined) keys.unshift(['↑↓', 'scroll']);
  body.splice(0, d.scroll);
  const x = Math.floor((g.width - width) / 2);
  const y = below + height < g.height - 1 ? below : Math.max(1, Math.floor((g.height - height) / 2));
  g.fill(x, y, width, height, { bg: 'raised' });
  g.box(x, y, width, height, { fg: 'you', bg: 'raised' });
  g.text(x + 2, y, title, YOU, width - 6);
  body.slice(0, height - 5).forEach(([line, style], i) => {
    if (style.bg) g.fill(x + 2, y + 2 + i, width - 4, 1, { bg: style.bg });
    g.text(x + 3, y + 2 + i, line, style, inner);
  });
  let kx = x + 3;
  keys.forEach(([key, label], i) => {
    if (i) kx = g.text(kx + 2, y + height - 2, '·', LINE) + 2;
    kx = g.text(kx, y + height - 2, key, key === '⏎' || key === 'y' ? YOU : BOLD);
    kx = g.text(kx + 1, y + height - 2, label, DIM);
  });
}

// The feature request that starts the pipeline, as you type it
function request(c: Content, d: DialogOf<'request'>): void {
  c.title = ' ▶ Create feature request ';
  paragraph(c, 'The research agent writes the specification, the plan agent the tickets, then you approve them.');
  blank(c);
  c.body.push(['Feature request:', DIM]);
  paragraph(c, `› ${d.text}█`);
  c.keys = [['⏎', 'start'], ['esc', 'cancel']];
}

// A ready ticket for an implement loop, or a specification for the plan agent
function pick(c: Content, d: DialogOf<'pick'>): void {
  const ralph = d.target === 'ralph';
  c.title = ralph ? ' ▶ Implement ticket ' : ' ▶ Plan tickets ';
  paragraph(c, ralph ? 'One Ralph loop on a ready ticket. Pick one:' : 'The plan agent turns a specification into tickets. Pick one:');
  blank(c);
  const items = d.items.map((item, i): [string, Style] => [`${i === d.cursor ? '›' : ' '}  ${item.id}  ${item.title}`, i === d.cursor ? PICKED : BOLD]);
  list(c, d, items, d.cursor);
  c.keys = [['↑↓', 'pick'], ['⏎', 'start'], ['esc', 'cancel']];
}

// A run of the latest evals: whether it was accepted and why, and what the grader said
function evalsRun(c: Content, { run: r }: DialogOf<'evalsRun'>): void {
  c.title = ` ${r.accepted ? '✓' : '✗'} ${r.task}, run ${r.run} `;
  c.body.push([r.accepted ? 'Accepted' : 'Not accepted', r.accepted ? BOLD : YOU]);
  paragraph(c, r.reason.split('\n').join(' '));
  blank(c);
  const merged = r.merged.length ? `, merged ${r.merged.join(' ')}` : '';
  c.body.push([`Cost ${dollars(r.costUsd)} · ${Math.round(r.durationS / 60)} min · pipeline: ${r.step}${merged}`, DIM]);
  if (r.grading) {
    blank(c);
    c.body.push(['The grader:', DIM]);
    // All of it, as Markdown, without the verdict line: the reason above already says it
    const grading = r.grading.trim().split('\n');
    const verdict = grading.map((line) => /^[\s>*`-]*(APPROVE|REJECT)\b/.test(line)).lastIndexOf(true);
    c.body.push(...markdown(grading.filter((_, i) => i !== verdict).join('\n'), c.width));
  }
  c.keys = [['esc', 'close']];
}

// A run of a case of the latest skill-loaded evals: whether the skill loaded as the case expects
function skillLoadedEvalRun(c: Content, d: DialogOf<'skillLoadedEvalRun'>): void {
  const { result } = d;
  const run = result.runs[d.run - 1];
  const ok = asExpected(run, result.loads);
  c.title = ` ${ok ? '✓' : '✗'} ${result.skill}, run ${d.run} `;
  c.body.push([ok ? 'As expected' : 'Not as expected', ok ? BOLD : YOU]);
  paragraph(c, result.prompt);
  blank(c);
  const did = run.failure ? `it failed: ${run.failure.split('\n')[0]}` : run.loaded ? 'it loaded' : "it didn't load";
  paragraph(c, `The skill should${result.loads ? '' : "n't"} load. In this run ${did}.`);
  blank(c);
  const expected = result.runs.filter((r) => asExpected(r, result.loads)).length;
  const cost = run.costUsd === undefined ? '' : ` · cost ${dollars(run.costUsd)}`;
  c.body.push([`The case ${result.pass ? 'passes' : 'fails'}: ${expected} of ${result.runs.length} runs as expected${cost}`, DIM]);
  c.keys = [['esc', 'close']];
}

// s in the Evals tab: what to run, what that will cost, and what isn't committed
function startEvals(c: Content, d: DialogOf<'startEvals'>): void {
  const choices = evalsChoices(d.tasks, d.skills);
  const choice = choices[d.cursor];
  c.title = ' ▶ Start evals ';
  const what = choice?.skills
    ? 'Checks whether the agent loads the skills that have a skill-loaded-evals.json: each case runs 3 times, and passes when most runs do what it expects. The improve agent then proposes changes for the failing cases.'
    : 'Grades the setup as it is committed: each task runs 3 times through the unattended pipeline, and each run is graded with the hidden tests and the grader.';
  paragraph(c, what);
  blank(c);
  const items = choices.map((option, i): [string, Style] => [`${i === d.cursor ? '›' : ' '}  ${option.label}`, i === d.cursor ? PICKED : BOLD]);
  list(c, d, items, d.cursor);
  blank(c);
  if (choice?.skills) {
    const runs = (d.skills?.cases ?? 0) * 3;
    const expected = estimateSkills(d.skillReports ?? [], runs);
    c.body.push([`${runs} runs. Cost: ${estimateText(expected, 'skill-loaded evals')}.`, BOLD]);
    const skills = d.uncommitted.filter((file) => file.startsWith('.agents/skills/'));
    if (skills.length) {
      blank(c);
      paragraph(c, `Not committed, but checked as they are: ${skills.join(', ')}`, DIM);
    }
  } else if (choice) {
    const runs = choice.tasks.length * 3;
    const expected = estimate(d.evalReports, runs);
    c.body.push([`${runs} runs. Cost: ${estimateText(expected, 'evals')}.`, BOLD]);
    if (d.uncommitted.length) {
      blank(c);
      paragraph(c, `Not committed, so not graded: ${d.uncommitted.join(', ')}`, YOU);
    }
  }
  c.keys = [['↑↓', 'pick'], ['⏎', 'start'], ['esc', 'cancel']];
}

// A ready ticket picked on the board
function start(c: Content, d: DialogOf<'start'>): void {
  c.title = ` ▶ Start ${d.ticket} `;
  paragraph(c, d.title, BOLD);
  blank(c);
  paragraph(c, 'Runs the Ralph loop on this ticket, in this repository: the agent implements it and commits step by step. You can watch it here and answer the judge.');
  blank(c);
  paragraph(c, `One run takes one step, then stops, so you can check it. The loop goes on until the ticket is done, at most ${MAX_RUNS} runs.`, DIM);
  c.keys = [['1', 'one run'], ['y', 'loop'], ['n', "don't"]];
}

// x in a ticket: throws its loop's work away, so the next loop on the ticket starts fresh
function discard(c: Content, d: DialogOf<'discard'>): void {
  c.title = ` ⚑ Throw away ${d.ticket} `;
  paragraph(c, d.title, BOLD);
  blank(c);
  const commits = d.commits ? `, with ${d.commits} commit${d.commits === 1 ? '' : 's'} that aren't anywhere else` : '';
  paragraph(c, `${d.running ? 'Stops its loop, removes' : 'Removes'} its worktree .harness/worktrees/${worktreeName(d.ticket)} and deletes ${branchOf(d.ticket)}${commits}.`);
  blank(c);
  paragraph(c, 'The next loop on the ticket starts fresh. Throw it away?', BOLD);
  c.keys = [['y', 'throw away'], ['n', "don't"]];
}

// p in the Evals tab: what the improve agent proposes, each evals under a rule with its label, the proposals'
// own headings below it
function proposals(c: Content, d: DialogOf<'proposals'>): void {
  c.title = ' Proposals ';
  d.sections.forEach(({ title: label, text }, i) => {
    if (i) blank(c);
    c.body.push([`── After ${label} ${'─'.repeat(Math.max(0, c.width - label.length - 10))}`, BOLD]);
    blank(c);
    c.body.push(...markdown(text, c.width));
  });
  blank(c);
  paragraph(c, 'Make the ones you agree with and commit: the next evals shows whether they helped.', DIM);
  c.keys = [['esc', 'close']];
}

// A ticket's file, opened on the board, with what you can do with it from there
function ticket(c: Content, d: DialogOf<'ticket'>): void {
  c.title = ` ${d.ticket.id} `;
  c.body.push(...markdown(d.content, c.width));
  if (d.related) c.keys.push(['⏎', actionOf(d.related)]);
  if (d.merge) c.keys.push(['m', 'merge'], ['d', 'diff in IDE']);
  if (d.start) c.keys.push(['s', 'start']);
  if (d.discard) c.keys.push(['x', 'throw away']);
  c.keys.push(['esc', 'close']);
}

// A finished loop's branch, picked on the board: what merging it brings, and whether it can
function mergeBranch(c: Content, { preview: p, into }: DialogOf<'mergeBranch'>): void {
  c.title = ` ⚑ Merge ${p.ticket} `;
  paragraph(c, p.title, BOLD);
  blank(c);
  c.body.push([`${p.branch} has ${p.commits.length} commit${p.commits.length === 1 ? '' : 's'} that ${into} doesn't have:`, DIM]);
  for (const commit of p.commits.slice(-6)) c.body.push([`  ${commit}`, {}]);
  if (p.commits.length > 6) c.body.push([`  … and ${p.commits.length - 6} before`, DIM]);
  if (p.stat) c.body.push([p.stat, DIM]);
  if (p.uncommitted.length) {
    blank(c);
    paragraph(c, `The loop left changes in its worktree it didn't commit, they don't get merged: ${p.uncommitted.join(', ')}`, YOU);
  }
  blank(c);
  if (p.conflicts) {
    paragraph(c, `It conflicts with ${into}. Rebase it by hand: git rebase ${into} ${p.branch}`, YOU);
    c.keys = [['d', 'diff in IDE'], ['esc', 'close']];
  } else if (!p.commits.length) {
    paragraph(c, 'Nothing to merge.', BOLD);
    c.keys = [['esc', 'close']];
  } else {
    paragraph(c, `It applies cleanly. Rebase it onto ${into} and fast-forward ${into}, without a merge commit? Run the tests after: task test`, BOLD);
    c.keys = [['y', 'rebase'], ['d', 'diff in IDE'], ['n', "don't"]];
  }
}

// Checkpoint 1 of the pipeline: the tickets you approve get a Ralph loop
function approve(c: Content, d: DialogOf<'approve'>, titles: Map<string, string>): void {
  c.title = ' ⚑ Approve tickets ';
  paragraph(c, 'Dispatch picked the tickets that are ready and independent. Only the ones you approve get a Ralph loop.');
  blank(c);
  const items = d.need.tickets.map((ticket, i): [string, Style] => {
    const on = d.selected.has(ticket);
    const style: Style = i === d.cursor ? PICKED : on ? BOLD : DIM;
    return [`${i === d.cursor ? '›' : ' '} ${on ? '◉' : '○'}  ${ticket}  ${titles.get(ticket) ?? ''}`, style];
  });
  list(c, d, items, d.cursor);
  if (!d.need.tickets.length) c.body.push(['No ticket is marked ready.', DIM]);
  c.keys = [['space', 'toggle'], ['⏎', `approve ${d.selected.size}`], ['esc', 'later']];
}

// Checkpoint 2 of the pipeline: what the review agent says, and whether to merge
function merge(c: Content, { need }: DialogOf<'merge'>): void {
  c.title = ' ⚑ Merge? ';
  c.body.push(['The review agent says:', BOLD]);
  // Its verdict line per branch, or the end of what it says if it wrote none
  const lines = verdicts(need.review, need.branches);
  for (const line of lines.length ? lines : wrap(need.review.trim().split('\n').slice(-6).join('\n'), c.width)) c.body.push([line, {}]);
  blank(c);
  if (need.problem) {
    paragraph(c, `It didn't merge: ${need.problem}. Then decide again.`, YOU);
    blank(c);
  }
  const branches = need.branches.join(', ') || 'nothing';
  paragraph(c, `Merge ${branches} into the branch you're on? Each one is rebased onto it and fast-forwarded, without a merge commit. The tests run after.`, BOLD);
  c.keys = [['y', 'merge'], ['n', "don't merge"], ['esc', 'later']];
}

// The judge's question, and your answer as you type it
function answer(c: Content, d: DialogOf<'answer'>): void {
  c.title = ` ⚑ The judge in ${d.need.workflowId} asks `;
  paragraph(c, d.need.question, BOLD);
  blank(c);
  c.body.push(['Your answer, the next run gets it:', DIM]);
  paragraph(c, `› ${d.text}█`);
  c.keys = [['⏎', 'send'], ['esc', 'later']];
}

// A workflow that failed, or one Temporal keeps retrying
function failed(c: Content, d: DialogOf<'failed'>): void {
  const stuck = d.need.kind === 'stuck';
  c.title = stuck ? ` ⚑ ${d.need.workflowId} is stuck ` : ` ✗ ${d.need.workflowId} failed `;
  paragraph(c, d.need.reason);
  blank(c);
  const hint = stuck
    ? 'Temporal keeps retrying it. Often the agent isn\'t logged in: put its token in .devcontainer/.env, the worker restarts by itself. The whole output: flows logs.'
    : `Details: flows status ${d.need.workflowId}, or open it in the Temporal UI on port 8233. In Lab 12, flows cleanup stops the pipeline so you can start it again.`;
  paragraph(c, hint, DIM);
  if (d.confirmDelete) {
    blank(c);
    paragraph(c, `Delete ${d.need.workflowId} from Temporal for good?`, BOLD);
    c.keys = [['y', 'delete'], ['n', "don't"]];
  } else {
    c.keys = d.need.kind === 'failed' ? [['d', 'delete it'], ['esc', 'close']] : [['esc', 'close']];
  }
}
