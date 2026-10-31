// The page of `flows watch`. Every 1.5 seconds it asks the server for the state (/api/state, see state.ts) and
// draws it: the pipeline map, what waits for you, the loops, the worker's output, the Evals tab. What you decide
// goes to /api/action (see actions.ts). The sections below: talking to the server, drawing each part, the dialogs,
// the tooltips with the commands, and the wiring.

let state = null; // the last answer of /api/state
let tab = 'pipeline';
const $ = (id) => document.getElementById(id);
// Escapes text for HTML. Every attribute below is in double quotes, so ' needs no escaping.
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dollars = (c) => (c === null ? 'unknown' : `$${(c ?? 0).toFixed(2)}`);
// The tooltip, one element, kept here: it moves into a dialog while it shows there, and a dialog drawn again
// would take it with it
const tip = $('tip');

// ── talking to the server ─────────────────────────────────────────────────────────────────────────

async function refresh() {
  if (document.hidden) return; // nobody looks: no need to ask
  try {
    state = await (await fetch('/api/state')).json();
  } catch {
    draw($('needs'), '<div class="need"><span class="text">flows watch stopped. Start it again: task flows:watch</span></div>');
    return;
  }
  render();
}

// Sends what you decided. The dialog closes once the server took it, else it stays, with what you typed.
async function act(action) {
  let res;
  try {
    res = await fetch('/api/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(action) });
  } catch {
    return toast("Couldn't reach flows watch. Is it still running?");
  }
  const { message } = await res.json().catch(() => ({ message: `flows watch answered ${res.status}.` }));
  if (res.ok) closeDialog();
  toast(message);
  refresh();
}

let toastTimer;
function toast(text) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('toast').hidden = true), 6000);
}

// Puts the HTML into a part of the page, only when it changed: what has the focus, or is selected, stays
function draw(el, html) {
  if (el.dataset.drawn === html) return false;
  el.innerHTML = html;
  el.dataset.drawn = html;
  return true;
}

// ── drawing ───────────────────────────────────────────────────────────────────────────────────────

function render() {
  $('branch').textContent = state.branch ?? '';
  for (const [what, ok] of [['temporal', state.temporal], ['worker', state.worker]]) {
    $(`${what}Dot`).className = `dot ${ok ? 'ok' : 'no'}`;
    $(`${what}Text`).textContent = `${what === 'temporal' ? 'Temporal' : 'Worker'}${ok ? '' : ' (not running)'}`;
  }
  document.querySelectorAll('[data-agent]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.agent === state.agent)));
  $('evalsTab').hidden = !state.evals;
  if (!state.evals && tab === 'evals') tab = 'pipeline';
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('on', t.dataset.tab === tab);
    t.setAttribute('aria-selected', String(t.dataset.tab === tab));
  });
  $('pipelineView').hidden = tab !== 'pipeline';
  $('evalsView').hidden = tab !== 'evals';
  renderNeeds();
  if (tab === 'pipeline') renderPipeline();
  else renderEvals();
  retip();
}

// What the button next to each need says
const ACTION = { approveSpecification: 'Decide', approvePlan: 'Decide', decideMerge: 'Decide', answer: 'Answer', failed: 'Details', stuck: 'Details' };

function renderNeeds() {
  let html;
  if (!state.temporal) html = '<div class="need"><span class="text">Temporal isn\'t running. Start it and the worker: task flows:start</span></div>';
  else if (!state.worker) html = '<div class="need"><span class="text">The worker isn\'t running, so nothing moves. Start it: task flows:start. Its output: flows logs</span></div>';
  else if (!state.needs.length) html = '<div class="need quiet"><span class="text">Nothing waits for you.</span></div>';
  else html = state.needs.map((n, i) => `<div class="need">⚑<span class="text">${esc(n.text)}</span><button type="button" class="btn you" data-need="${i}" ${needCmd(n)}>${ACTION[n.kind]}</button></div>`).join('');
  draw($('needs'), html);
}

// The command behind a need's button: a checkpoint's is its box's, see BOXES in workflows/map.ts
function needCmd(n) {
  const checkpoint = { approveSpecification: 'specification', approvePlan: 'plan', decideMerge: 'merge' }[n.kind];
  const box = state.boxes.find((b) => b.checkpoint === checkpoint);
  if (box) return cmd(box.command, box.note);
  if (n.kind === 'answer') return cmd(`flows answer ${n.workflowId} "<answer>"`, 'The next run gets your answer');
  return n.kind === 'failed' ? cmd(`flows status ${n.workflowId}`, 'Why it failed') : cmd('flows logs', 'What the worker says');
}
const cmd = (command, note) => `data-cmd="${esc(command)}" data-note="${esc(note)}"`;

// The map: the rows' names on the left, one column per box of BOXES, a stage over its boxes
function renderPipeline() {
  const { boxes, stages, current, pipeline } = state;
  const curStage = current >= 0 ? boxes[current].stage : -1;
  const col = (i) => i + 2;
  const span = (si) => {
    const inStage = boxes.map((b, i) => [b, i]).filter(([b]) => b.stage === si).map(([, i]) => i);
    return `${col(inStage[0])} / ${col(inStage.at(-1)) + 1}`;
  };
  let h = '<div class="lbl" style="grid-column:1;grid-row:1">Stage</div>';
  stages.forEach((st, si) => (h += `<div class="stage${si === curStage ? ' active' : ''}" style="grid-column:${span(si)};grid-row:1">${esc(st.name)}</div>`));

  h += '<div class="lbl" style="grid-column:1;grid-row:2;align-self:end;padding-bottom:var(--s3)">Step<small>flows status</small></div>';
  boxes.forEach((b, i) => {
    const step = esc(b.steps[0]).replace(/^waiting for your /, 'waiting for your<br>');
    h += `<div class="step${i === current ? ' cur' : ''}" style="grid-column:${col(i)};grid-row:2" ${cmd('flows status pipeline', 'The step, as flows status says it')}>${step}</div>`;
  });

  h += '<div class="lbl" style="grid-column:1;grid-row:3">Who<small>an agent, or you</small></div>';
  boxes.forEach((b, i) => {
    const action = boxAction(b, i);
    h += `<div class="box who-${b.who} ${b.state}${b.many ? ' many' : ''}" id="box-${i}" data-box="${i}" style="grid-column:${col(i)};grid-row:3" ${cmd(b.command, b.note)}${action ? ' role="button" tabindex="0"' : ''}>
      <div class="t">${esc(b.name)}</div><div class="s">${subline(b).map((part) => `<span>${esc(part)}</span>`).join(' · ')}</div>${pill(b)}</div>`;
  });

  h += '<div class="lbl" style="grid-column:1;grid-row:4">Sent back</div><div class="back" style="grid-column:2 / -1;grid-row:4"></div>';
  h += '<div class="lbl" style="grid-column:1;grid-row:5;align-self:start;padding-top:var(--s2)">Handoff<small>what it leaves</small></div>';
  stages.forEach((st, si) => {
    const reached = pipeline?.state === 'done' || curStage >= si;
    h += `<div class="handoff${reached ? '' : ' dimmed'}" style="grid-column:${span(si)};grid-row:5">${esc(st.handoff)}</div>`;
  });
  h += '<svg class="arcs" id="arcs" aria-hidden="true"></svg>';

  const map = $('map');
  map.style.gridTemplateColumns = `var(--label) repeat(${boxes.length}, minmax(112px, 1fr))`;
  map.style.minWidth = `${132 + boxes.length * 128}px`;
  if (draw(map, h)) drawArcs();
  $('cost').textContent = pipeline ? `cost so far ${dollars(pipeline.cost)}` : '';

  // The loops, and what you can start on its own
  const implement = state.ready.length ? `<button type="button" class="btn run" id="implement" ${cmd('flows ralph <task>', 'A loop of its own, on one ready task')}>Implement a task…</button>` : '';
  const STATE = { running: '● running', you: '⚑ needs you', failed: '✗ failed', done: '✓ done', stopped: '– stopped' };
  draw($('loops'), state.loops.length
    ? state.loops.map((l, i) => `<button type="button" class="loop ${l.state}" data-loop="${i}" ${cmd(`flows status ${l.workflowId}`, 'What this loop is doing')}><span class="id">${esc(l.task)}</span><span class="tt">${esc(l.title)}</span><span class="st">${STATE[l.state]}</span><span class="id">${l.run ? `run ${l.run}` : ''}</span><span class="note">${esc(l.question ? 'the judge asks a question' : l.failure ?? (l.merged === false ? 'not merged' : l.merged ? 'merged' : ''))}</span></button>`).join('') + (implement ? `<div>${implement}</div>` : '')
    : `<div class="empty"><span>No loops yet. Approve a plan, or implement a ready task on its own.</span>${implement}</div>`);

  // The worker's output follows the new lines, unless you scrolled up to read
  const log = $('log');
  const text = state.log.length ? state.log.join('\n') : 'Nothing yet. Everything the agents print shows up here, and in flows logs.';
  if (log.textContent !== text) {
    const following = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
    log.textContent = text;
    if (following) log.scrollTop = log.scrollHeight;
  }
}

// What a box says under its name, in parts that wrap as a whole: an agent's model and runs, a checkpoint's decision,
// or what it does now. A model is named without its claude- prefix, so Copilot's ids fit the box.
function subline(b) {
  const model = b.model?.replace(/^claude-/, '');
  if (b.who === 'agent' && b.state === 'running') return b.role === 'implement' ? [b.label] : [model, `run ${state.pipeline?.run ?? 1}/${b.runs}`];
  if (b.who === 'agent') return [model, b.runs && `≤${b.runs} runs`].filter(Boolean);
  if (b.who === 'you') return [b.state === 'todo' ? 'your decision' : b.label];
  return ['plain code'];
}

// What checks a box's work, on its bottom edge: the judge, the tests, or nothing. While the judge checks, it says so.
function pill(b) {
  if (b.who === 'you') return '';
  if (b.judging) return '<span class="pill judging">⚖ checking</span>';
  if (b.check) return `<span class="pill">${esc(b.check)}${b.who === 'agent' ? ' ↺' : ''}</span>`;
  return '<span class="pill none">no judge</span>';
}

// What clicking a box does: start the pipeline, open the decision it waits for, or implement a task on its own
function boxAction(b, i) {
  if (b.role === 'research' && state.pipeline?.state !== 'running') return openRequest;
  if (b.checkpoint && i === state.current) {
    const need = state.needs.find((n) => ['approveSpecification', 'approvePlan', 'decideMerge'].includes(n.kind));
    if (need) return () => openNeed(need);
  }
  if (b.role === 'implement' && state.ready.length) return pickTask;
  return undefined;
}

// The arrows between the boxes, and where a checkpoint sends its handoff back: dashed until it's in play
function drawArcs() {
  const base = $('map').getBoundingClientRect();
  const box = (i) => $(`box-${i}`).getBoundingClientRect();
  const marker = (id, color, size = 7) => `<marker id="${id}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="${size}" markerHeight="${size}" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="${color}"/></marker>`;
  let out = `<defs>${marker('ah', 'var(--you)')}${marker('ahd', 'var(--dim)')}${marker('af', 'var(--line)', 6)}</defs>`;
  for (let i = 0; i < state.boxes.length - 1; i++) {
    const a = box(i), b = box(i + 1), y = a.top + a.height / 2 - base.top;
    out += `<path d="M${a.right - base.left + 2} ${y} H${b.left - base.left - 3}" stroke="var(--line)" stroke-width="1.4" fill="none" marker-end="url(#af)"/>`;
  }
  state.boxes.forEach((b, i) => {
    if (b.sendsBackTo === undefined) return;
    const from = box(i), to = box(b.sendsBackTo);
    const x1 = from.left + from.width / 2 - base.left, x2 = to.left + 14 - base.left;
    const y0 = from.bottom - base.top + 14, yl = from.bottom - base.top + 36;
    const times = state.pipeline?.revised?.[b.checkpoint] ?? 0;
    const live = i === state.current || times > 0;
    const color = live ? 'var(--you)' : 'var(--dim)';
    out += `<path d="M${x1} ${y0} V${yl} H${x2} V${to.bottom - base.top + 4}" stroke="${color}" stroke-width="1.4" fill="none" ${live ? '' : 'stroke-dasharray="4 3"'} marker-end="url(#${live ? 'ah' : 'ahd'})"/>`;
    out += `<text x="${(x1 + x2) / 2}" y="${yl + 18}" text-anchor="middle" fill="${color}" font-family="system-ui, sans-serif" font-size="12" font-weight="500">${esc(b.sendsBack + (times ? ` · ${times}×` : ''))}</text>`;
  });
  $('arcs').innerHTML = out;
}

// The Evals tab, laid out like the pipeline's lower half: the rows' names on the left, white rows on the right. Blue is
// what runs, purple what waits for you, red only in text. A switch picks the skill-loaded or the end-to-end evals;
// until you pick, it shows the end-to-end evals while only they run, else the skill-loaded evals, as the lab starts there.
let evalsKind;
const lbl = (title, small) => `<div class="lbl">${title}${small ? `<small>${small}</small>` : ''}</div>`;
// A thin bar: the runs done in grey, the ones working in blue
const progress = (done, working, of) => `<div class="progress"><span style="width:${of ? (done / of) * 100 : 0}%"></span><span class="now" style="width:${of ? (working / of) * 100 : 0}%"></span></div>`;
// The bar under a run: one part per step of EVAL_STEPS
const segs = (marks) => `<span class="segs">${marks.map((m) => `<span class="seg ${m}"></span>`).join('')}</span>`;

function renderEvals() {
  const e = state.evals;
  const kind = evalsKind ?? (e.running && !e.runningSkills ? 'e2e' : 'skills');
  const skills = e.skills.at(-1), latest = e.trend.at(-1);
  const option = (k, label, score) => `<button type="button" data-kind="${k}" aria-pressed="${k === kind}">${label} <span class="score">· ${score}</span></button>`;
  const running = '<span class="running">running</span>';
  const skillsScore = e.runningSkills ? running : skills ? `${skills.cases} / ${skills.of} cases` : 'not run yet';
  const e2eScore = e.running ? running : latest ? `${latest.quality.accepted} / ${latest.quality.of} runs` : 'not run yet';
  const question = kind === 'skills' ? 'Does the agent load each skill when it should? A few minutes, cents per run.' : `Does the pipeline build features you would ship? About 18 minutes and $4 per run, ${e.tasks.length * e.runsPerTask} runs for all tasks.`;
  const start = kind === 'skills'
    ? !e.runningSkills && `<button type="button" class="btn run" data-do="startSkills" ${cmd('flows skill-loaded-evals', `Every case in a skill's skill-loaded-evals.json runs ${e.runsPerTask} times. It checks your checkout as it is: no commit needed`)}>${e.latestSkills ? 'Run again' : 'Start skill-loaded evals'}</button>`
    : !e.running && `<button type="button" class="btn run" data-do="startEvals" ${cmd('flows evals [task] --yes', `Every task runs ${e.runsPerTask} times through the unattended pipeline, and each run is graded`)}>Start evals…</button>`;
  let h = kind === 'skills' ? skillsNeed(e) : e2eNeed(e);
  h += `<div class="evals-bar"><span class="segmented"><span class="options">${option('skills', 'Skill loaded', skillsScore)}${option('e2e', 'End-to-end', e2eScore)}</span></span><span class="legend">${question}</span>${start || ''}</div>`;
  h += `<div class="rows">${kind === 'skills' ? skillsRows(e) : e2eRows(e)}</div>`;
  draw($('evalsView'), h);
}

// What waits for you after an evals run: the improve agent's proposals. When the agent failed, it says so, and for the
// end-to-end evals offers the newest proposals there are, from an evals before.
const failedProposals = (proposals) => /^The improve agent couldn't/.test(proposals ?? '');
const proposalsNeed = (text, which, label) => {
  const proposals = state.evals.proposals[which];
  if (failedProposals(proposals)) {
    const trend = state.evals.trend;
    const i = which === 'e2e' ? trend.findLastIndex((t) => t.proposals && !failedProposals(t.proposals)) : -1;
    const earlier = i < 0 ? '' : `<button type="button" class="btn you" data-do="proposals" data-trend="${i}">Read the proposals of ${esc(trend[i].label)}</button>`;
    const why = proposals.replace(/^The improve agent couldn't write proposals:\s*/, '');
    return `<div class="need">⚑<span class="text">The improve agent couldn't write proposals for the latest evals: ${esc(why)}. See flows logs.</span>${earlier}</div>`;
  }
  return `<div class="need">⚑<span class="text">${text}</span><button type="button" class="btn you" data-do="proposals" data-which="${which}">${label}</button></div>`;
};

function skillsNeed(e) {
  const failing = (e.latestSkills?.groups ?? []).filter((g) => g.passing < g.of);
  if (e.runningSkills || !e.proposals.skills || !failing.length) return '';
  const what = failing.map((g) => `${g.of - g.passing} ${g.of - g.passing === 1 ? 'case' : 'cases'} of ${esc(g.skill)}`).join(', ');
  const one = failing.length === 1 && failing[0].of - failing[0].passing === 1;
  return proposalsNeed(`${what} ${one ? 'fails' : 'fail'}. The improve agent proposes a new description. Agents may not change .agents/, so applying it is up to you.`, 'skills', 'Read the proposal');
}

function e2eNeed(e) {
  if (e.running || !e.proposals.e2e) return '';
  return proposalsNeed("The improve agent grouped why runs weren't right the first time, and proposes changes to the skills and the harness. Make the ones you agree with and commit: the next evals shows whether they helped.", 'e2e', 'Read the proposals');
}

// The skill-loaded evals: the latest run, or the one that runs, then per skill its cases, run by run
function skillsRows(e) {
  const runs = e.runsPerTask, running = e.runningSkills, last = e.latestSkills;
  const now = e.skills.at(-1), before = e.skills.at(-2);
  let h = '';
  if (running) {
    const s = running.status;
    const done = s?.done ?? 0, of = s?.runs ?? 0, right = s?.asExpected ?? 0;
    const line = s?.step === 'writing proposals' ? '<b>The runs are done.</b> <span class="dim">The improve agent writes its proposals.</span>' : `<b>${done} of ${of || '…'} runs done</b> <span class="dim">· ${right} did what their case expects, ${done - right} didn't · ${dollars(s?.costUsd)} so far</span>`;
    h += lbl('Running', 'flows skill-loaded-evals') + `<div class="row-box"><div class="line"><span>${line}</span>${now ? `<span class="legend">The run before, ${esc(now.label)}: ${now.cases} of ${now.of} cases</span>` : ''}</div>${progress(done, of - done, of)}</div>`;
  } else if (last) {
    const delta = before ? now.cases - before.cases : 0;
    const compared = !before ? '' : delta ? ` · ${Math.abs(delta)} ${delta < 0 ? 'fewer' : 'more'} than the run before` : ' · the same as the run before';
    const changed = last.uncommitted.length ? `, plus your uncommitted ${last.uncommitted.map((f) => `<code>${esc(f)}</code>`).join(', ')}` : ', nothing uncommitted';
    const bars = e.skills.slice(-12).map((t, i, all) => `<span class="tb${i === all.length - 1 ? ' last' : ''}" style="height:${Math.max(2, Math.round((t.cases / Math.max(1, t.of)) * 40))}px" data-note="${esc(`${t.label} · ${t.commit}${t.uncommitted ? ' with uncommitted changes' : ''}: ${t.cases} of ${t.of} cases`)}"></span>`).join('');
    h += lbl('Latest', 'flows skill-loaded-evals') + `<div class="row-box summary"><div><span><b class="big">${now.cases} of ${now.of} cases pass</b><span class="dim">${compared}</span></span>
      <span class="legend">${esc(now.label)} · checked commit <code>${esc(last.commit)}</code>${changed} · ${last.runs} runs, every case ${runs} times · ${dollars(last.costUsd)}</span></div>
      <div class="trend" aria-label="Cases passing, the oldest run first">${bars}</div></div>`;
  } else {
    h += lbl('Latest') + `<div class="empty"><span>No skill-loaded evals yet. They check whether the agent loads each skill when it should, for the prompts in each skill's skill-loaded-evals.json.</span></div>`;
  }

  for (const g of running ? running.groups : last?.groups ?? []) {
    const decided = g.cases.every((c) => c.pass !== undefined);
    const verdict = !decided ? `${g.passing} of ${g.of} pass so far` : g.passing === g.of ? `Passes · ${g.of} of ${g.of}` : `<span class="worse">Fails · ${g.passing} of ${g.of}</span>`;
    h += lbl(esc(g.skill), verdict) + '<div class="cases">';
    if (g.description) h += `<p class="legend">Loads by its description: <code class="desc">${esc(g.description)}</code>${g.changed ? ' <span class="problem">· changed, not committed</span>' : ''}</p>`;
    h += `<div class="case head"><span>Prompt</span>${[...Array(runs)].map((_, i) => `<span>Run ${i + 1}</span>`).join('')}<span>Case</span></div>`;
    h += g.cases.map((c) => {
      const right = c.runs.filter((r) => r.ok).length;
      const cells = c.runs.map((r) => {
        if (r.ok === undefined) return '<span class="running">● running</span>';
        return r.ok ? `<span class="dim">${r.text}</span>` : `<b class="worse" ${r.failure ? `data-note="${esc(r.failure)}"` : ''}>✗ ${r.text}</b>`;
      }).join('');
      const verdictCell = c.pass === undefined ? '<span class="dim">…</span>' : c.pass ? `Pass${right < c.runs.length ? `<span class="dim">, ${right} of ${c.runs.length}</span>` : ''}` : '<b class="worse">Fail</b>';
      return `<div class="case"><span><span class="legend">${c.loads ? 'should load' : 'should not load'} ·</span> ${esc(c.prompt)}</span>${cells}<span>${verdictCell}</span></div>`;
    }).join('');
    h += '</div>';
  }
  if (running || last) h += `<div></div><p class="legend">A case passes when at least 2 of its ${runs} runs do what it expects. ✗ marks a run that didn't. Plain code reads the agent's tool calls, no judge: fast, cheap, and the same every time.</p>`;
  return h;
}

// The end-to-end evals: the one that runs, the key numbers, why runs weren't accepted, each task run by run, the trend.
// While an evals runs, its runs fill the grid; after it, the grid shows how each run went.
function e2eRows(e) {
  const runs = e.runsPerTask, r = e.running, latest = e.trend.at(-1);
  let h = '';
  if (r) {
    const waiting = r.of - r.done - r.working;
    h += lbl('Evals', 'flows evals') + `<div class="row-box" ${cmd('flows evals --stop', 'Stops the running evals. The runs that finished keep their results')}><div class="line">
      <span><b>${r.done} of ${r.of || '…'} runs done</b> <span class="dim">· <span class="running">● ${r.working} running</span> · ${waiting} waiting · ${dollars(r.costUsd)} so far</span></span>
      <span class="legend"><code>${esc(r.workflowId)}</code></span></div>${progress(r.done, r.working, r.of)}</div>`;
  }
  if (!r && !latest) {
    return h + lbl('Latest') + `<div class="empty"><span>No end-to-end evals yet. Every task runs ${runs} times through the unattended pipeline, and each run is graded. A run costs a few dollars: start with one task.</span></div>`;
  }

  // The key numbers: of the runs done so far while it runs, else of the latest evals, each next to the one before
  const base = r ? latest : e.trend.at(-2);
  const was = (text) => (base ? `${r ? 'Last evals' : 'The evals before'}: ${text}` : '');
  const tile = (key, value, of, caption, before, note) =>
    `<div class="tile" data-note="${esc(note)}"><span class="k">${key}</span><span class="v">${value}${of !== '' ? `<small> / ${of}</small>` : ''}</span><span class="h">${caption}</span><span class="h dim">${before}</span></div>`;
  const n = r ?? latest;
  const ftr = r ? undefined : latest.firstTimeRight;
  const cpa = n.costPerAccepted;
  h += lbl('Numbers', r ? `so far, of ${r.done} ${r.done === 1 ? 'run' : 'runs'} done` : `${esc(latest.label)} · ${latest.tasks} ${latest.tasks === 1 ? 'task' : 'tasks'}`) + `<div class="tiles">
    ${tile('Quality', n.quality.accepted, n.quality.of, 'runs accepted', was(base && `${base.quality.accepted} / ${base.quality.of}`), 'Accepted runs, of all runs. A change of less than 3 runs is noise.')}
    ${tile('Reliability', n.reliability.of ? n.reliability.tasks : '–', n.reliability.of || '', `tasks with all ${runs} runs accepted`, was(base && `${base.reliability.tasks} / ${base.reliability.of}`), 'Only these are candidates for unattended runs. A change of 1 task is noise.')}
    ${tile('First time right', ftr ? ftr.runs : '–', ftr ? ftr.of : '', r ? 'shows once the evals is done' : 'accepted, no step sent back', was(base?.firstTimeRight ? `${base.firstTimeRight.runs} / ${base.firstTimeRight.of}` : '–'), 'Accepted, and no judge and no plain-code check rejected a step on the way.')}
    ${tile('Cost per accepted', cpa == null ? '–' : dollars(cpa), '', 'all runs, per accepted run', was(base?.costPerAccepted == null ? '–' : dollars(base.costPerAccepted)), 'What all runs cost, the ones not accepted too, divided by the accepted ones.')}
  </div>`;

  // Why runs weren't accepted, grouped: only once the evals is done, the running one doesn't know yet
  const all = r ? [] : e.latest.flatMap((row) => row.runs.map((run) => ({ ...run, task: row.task })));
  const notAccepted = all.filter((run) => !run.accepted);
  if (notAccepted.length) {
    const WHY = [['merged', 'The review merged nothing'], ['tests', 'Hidden tests fail'], ['grader', 'The grader rejects it'], ['failed', 'The run failed']];
    const most = Math.max(...WHY.map(([w]) => notAccepted.filter((run) => run.why === w).length));
    h += lbl('Not accepted', `${notAccepted.length} of ${all.length} runs`) + '<div class="row-box"><div class="why">';
    for (const [w, title] of WHY) {
      const these = notAccepted.filter((run) => run.why === w);
      if (!these.length) continue;
      const byTask = [...new Set(these.map((run) => run.task))].map((t) => `${esc(t)} ${these.filter((run) => run.task === t).map((run) => run.run).join(', ')}`).join(' · ');
      h += `<span>${title}</span><span class="count"><span class="b" style="width:${Math.round((these.length / most) * 96)}px"></span>${these.length}</span><span class="legend">${byTask}</span>`;
    }
    h += '</div>';
    const sent = all.filter((run) => run.sentBack > 0);
    h += `<p class="legend">A run is accepted when something was merged, the tests pass with the hidden ones, and the grader would ship it.${sent.length ? ` On the way, a judge or a check sent a step back ${sent.reduce((k, run) => k + run.sentBack, 0)} times, in ${sent.length} of ${all.length} runs.` : ''}</p></div>`;
  }

  // Each task, run by run
  const STATUS = { merged: 'Not merged', tests: 'Hidden tests fail', grader: 'Grader rejects', failed: 'Failed' };
  const columns = `style="grid-template-columns: 180px repeat(${runs}, minmax(200px, 1fr))"`;
  const cell = (run) => {
    if (run.state === 'waiting') return `<div class="cell wait"><span class="ct"><span class="dim">waiting</span></span>${segs(e.steps.map(() => 'na'))}</div>`;
    if (run.state !== 'done') {
      const at = run.step ?? 0;
      return `<div class="cell now"><span class="ct"><b class="running">● ${esc(e.steps[at])}${run.you ? ' ⚑' : ''}</b><span class="legend">${dollars(run.costUsd)}</span></span>${segs(e.steps.map((_, i) => (i < at ? 'ok' : i === at ? 'now' : 'na')))}<span class="note">${esc(run.doing ?? '')}</span></div>`;
    }
    return `<div class="cell"><span class="ct">${run.accepted ? '<b>✓ Accepted</b>' : '<b class="worse">✗ Not accepted</b>'}<span class="legend">${dollars(run.costUsd)}</span></span>${segs(e.steps.map(() => 'ok'))}</div>`;
  };
  const result = (run, ri) => {
    const note = run.accepted ? (run.sentBack ? `sent back ${run.sentBack}×` : 'right the first time') : run.brief || run.reason;
    return `<button type="button" class="cell" data-row="${ri}"><span class="ct">${run.accepted ? '<b>✓ Accepted</b>' : `<b class="worse">✗ ${STATUS[run.why]}</b>`}<span class="legend">${dollars(run.costUsd)} · ${Math.round(run.durationS / 60)} min</span></span>${segs(run.steps)}<span class="note">${esc(note)}</span></button>`;
  };
  const rows = r ? r.rows : e.latest;
  h += lbl('Runs', `${runs} per task`) + `<div class="grid-runs"><div class="task head" ${columns}><span>Task</span>${[...Array(runs)].map((_, i) => `<span>Run ${i + 1}</span>`).join('')}</div>`;
  h += rows.map((row, ri) => `<div class="task" ${columns}><b>${esc(row.task)}</b>${row.runs.map((run) => (r ? cell(run) : result(run, ri))).join('')}</div>`).join('');
  h += `<p class="legend">The bar is the run's pipeline, unattended: ${e.steps.map(esc).join(' · ')}. ${r ? '<span class="running">Blue</span> is where it is now.' : 'Dark: sent back by a judge, then passed · <span class="worse">red</span>: stopped there. Select a run for the grader\'s verdict and the full reasons.'}</p></div>`;

  // The trend: one column per evals
  h += lbl('Trend', 'one column per evals');
  if (e.trend.length > 1) {
    const row = (name, c) => `<tr><td>${name}</td>${e.trend.map(c).join('')}</tr>`;
    h += '<div class="row-box scroll"><table><tr><th></th>' + e.trend.map((t) => `<th>${esc(t.label)}${t.modelsChanged ? ' *' : ''}<br><code>${esc(t.commit)}</code></th>`).join('') + '</tr>';
    h += row('Quality', (t) => `<td>${t.quality.accepted} / ${t.quality.of}</td>`);
    h += row('Reliability', (t) => `<td>${t.reliability.tasks} / ${t.reliability.of}</td>`);
    h += row('First time right', (t) => `<td>${t.firstTimeRight ? `${t.firstTimeRight.runs} / ${t.firstTimeRight.of}` : '–'}</td>`);
    h += row('Cost per accepted', (t) => `<td>${t.costPerAccepted == null ? '–' : dollars(t.costPerAccepted)}</td>`);
    h += row('Proposals', (t, i) => `<td>${!t.proposals ? '–' : failedProposals(t.proposals) ? `<span class="dim" data-note="${esc(t.proposals)}">failed</span>` : `<button type="button" class="link" data-do="proposals" data-trend="${i}">Read</button>`}</td>`) + '</table>';
    if (e.trend.some((t) => t.modelsChanged)) h += '<p class="legend">* other models than in the evals before: opus and sonnet resolve to their latest version</p>';
    h += '</div>';
  } else h += '<div class="empty"><span>One evals so far. After you change a skill and commit, run again: a new column shows whether it helped. A change of fewer than 3 runs is noise.</span></div>';
  return h;
}

// ── dialogs ───────────────────────────────────────────────────────────────────────────────────────

// A dialog: its title, its body, and its buttons, each [label, class, what it does, its command]
function openDialog(title, body, buttons, cancel = 'Later') {
  const d = $('dialog');
  d.className = '';
  hideTip(); // out of the dialog first, which is drawn again below
  const button = ([label, cls, , command], i) => `<button type="button" class="btn ${cls}" data-b="${i}" ${command ? `data-cmd="${esc(command)}"` : ''}>${esc(label)}</button>`;
  d.innerHTML = `<h3>${esc(title)}</h3>${body}<div class="actions">${buttons.map(button).join('')}<button type="button" class="btn" data-close>${esc(cancel)}</button></div>`;
  d.onclick = (e) => {
    const b = e.target.closest('[data-b]');
    if (b) buttons[b.dataset.b][2]();
    if (e.target.closest('[data-close]')) closeDialog();
  };
  if (!d.open) d.showModal();
  d.querySelector('textarea, input, select, [data-b], [data-close]')?.focus();
}

function closeDialog() {
  hideTip();
  if ($('dialog').open) $('dialog').close();
}

function openRequest() {
  openDialog('Create feature request', '<p class="dim">The research agent writes the specification, you approve it, the design and the plan agent write the design and the tasks, then you approve them.</p><textarea id="request" aria-label="Feature request" placeholder="Feature request"></textarea>',
    [['Start the pipeline', 'primary', () => act({ kind: 'start', request: $('request').value }), 'flows start "<feature request>"']], 'Cancel');
}

function revise(need, on) {
  const what = on === 'specification' ? 'The research agent revises the specification with your feedback, then it asks you again.' : "The plan's tasks go, the design agent revises the design with your feedback, and the plan agent cuts the tasks again. Then it asks you again.";
  openDialog(`Send the ${on} back`, `<p class="dim">${what}</p><textarea id="feedback" aria-label="Your feedback" placeholder="Your feedback"></textarea>`,
    [['Send back', 'primary', () => act({ kind: 'revise', workflowId: need.workflowId, on, feedback: $('feedback').value }), `flows revise ${on} "<feedback>"`]], 'Cancel');
}

// The specification the research agent wrote, and the design next to it, as the pipeline recorded them
function files() {
  const spec = state.pipeline?.specification;
  if (!spec) return { spec: 'the specification in specs/', design: 'next to the specification' };
  return { spec: `<b>${esc(spec)}</b>`, design: `<b>${esc(spec.replace(/[^/]*$/, "design.md"))}</b>` };
}

function openNeed(need) {
  const titles = new Map([...state.ready, ...state.loops.map((l) => ({ id: l.task, title: l.title }))].map((t) => [t.id, t.title]));
  const { workflowId } = need;
  if (need.kind === 'approveSpecification') {
    openDialog('⚑ Approve the specification', `<p>The research agent wrote ${files().spec}, on your branch. Read it there.</p><p class="dim">Approve it and the design agent goes on, or send it back with feedback and the research agent revises it.</p>`,
      [['Send back…', 'you', () => revise(need, 'specification'), 'flows revise specification "<feedback>"'], ['Approve', 'primary', () => act({ kind: 'approveSpecification', workflowId }), 'flows approve specification']]);
  } else if (need.kind === 'approvePlan') {
    const list = need.tasks.map((t) => `<label><input type="checkbox" value="${esc(t)}" checked> ${esc(t)} <span class="dim">${esc(titles.get(t) ?? '')}</span></label>`).join('') || '<p class="dim">No task is marked ready.</p>';
    const tasks = () => [...$('dialog').querySelectorAll('input:checked')].map((i) => i.value);
    openDialog('⚑ Approve the plan', `<p>The design is ${files().design}, the tasks are in backlog/, on your branch. Dispatch picked the tasks that are ready and independent. Only the ones you approve get a loop.</p>${list}`,
      [['Send back…', 'you', () => revise(need, 'plan'), 'flows revise plan "<feedback>"'], ['Approve', 'primary', () => act({ kind: 'approvePlan', workflowId, tasks: tasks() }), 'flows approve plan']]);
  } else if (need.kind === 'decideMerge') {
    const problem = need.problem ? `<p class="problem">It didn't merge: ${esc(need.problem)}. Then decide again.</p>` : '';
    openDialog('⚑ Merge?', `<p class="dim">The review agent says:</p><pre>${esc(need.verdicts.join('\n'))}</pre>${problem}<p>Merge ${esc(need.branches.join(', ') || 'nothing')} into the branch you're on? Each one is rebased onto it and fast-forwarded, without a merge commit. The tests run after.</p>`,
      [["Don't merge", '', () => act({ kind: 'decideMerge', workflowId, yes: false }), 'flows merge'], ['Merge', 'primary', () => act({ kind: 'decideMerge', workflowId, yes: true }), 'flows merge']]);
  } else if (need.kind === 'answer') {
    openDialog(`⚑ The judge in ${workflowId} asks`, `<p>${esc(need.question)}</p><textarea id="answer" aria-label="Your answer" placeholder="Your answer, the next run gets it"></textarea>`,
      [['Send', 'primary', () => act({ kind: 'answer', workflowId, text: $('answer').value }), `flows answer ${workflowId} "<answer>"`]]);
  } else {
    const stuck = need.kind === 'stuck';
    const hint = stuck ? "Temporal keeps retrying it. Often the agent isn't logged in: put its token in .devcontainer/.env, the worker restarts by itself. The whole output: flows logs." : `Details: flows status ${esc(workflowId)}, or open it in the Temporal UI on port 8233. flows cleanup stops the pipeline so you can start it again.`;
    openDialog(stuck ? `⚑ ${workflowId} is stuck` : `✗ ${workflowId} failed`, `<pre>${esc(need.reason)}</pre><p class="dim">${hint}</p>`,
      stuck ? [] : [['Delete it', 'you', () => act({ kind: 'delete', workflowId })]], 'Close');
  }
}

function pickTask() {
  const choices = state.ready.map((t, i) => `<label><input type="radio" name="task" value="${esc(t.id)}" ${i ? '' : 'checked'}> ${esc(t.id)} <span class="dim">${esc(t.title)}</span></label>`).join('');
  const task = () => $('dialog').querySelector('input[name=task]:checked')?.value;
  openDialog('Implement a task', `<p class="dim">A loop of its own, in a worktree on the branch agent/&lt;task&gt;.</p>${choices}`,
    [['One run', '', () => act({ kind: 'ralph', task: task(), runs: 1 }), 'flows ralph <task> --runs 1'], ['Loop until done', 'primary', () => act({ kind: 'ralph', task: task() }), 'flows ralph <task>']], 'Cancel');
}

async function openTask(id) {
  const res = await fetch(`/api/task?id=${encodeURIComponent(id)}`);
  const t = await res.json();
  if (!res.ok) return toast(t.message);
  const need = state.needs.find((n) => (n.kind === 'answer' && n.task === id) || ((n.kind === 'failed' || n.kind === 'stuck') && n.workflowId.endsWith(`-${id}`)));
  const buttons = [];
  if (need) buttons.push([ACTION[need.kind], 'you', () => openNeed(need)]);
  if (t.merge) buttons.push(['Diff in IDE', '', () => act({ kind: 'diff', task: id })], ['Merge into your branch', 'primary', () => act({ kind: 'mergeBranch', task: id })]);
  if (t.discard) {
    const confirm = () => openDialog(`Throw away ${id}?`, `<p>Removes its worktree ${esc(t.worktree)} and deletes ${esc(t.branch)}. The next loop on the task starts fresh.</p>`, [['Throw away', 'primary', () => act({ kind: 'discard', task: id })]], "Don't");
    buttons.push(['Throw away', 'you', confirm]);
  }
  if (t.start) buttons.push(['One run', '', () => act({ kind: 'ralph', task: id, runs: 1 }), `flows ralph ${id} --runs 1`], ['Loop until done', 'run', () => act({ kind: 'ralph', task: id }), `flows ralph ${id}`]);
  openDialog(id, `<pre>${esc(t.content)}</pre>`, buttons, 'Close');
}

function openEvalsStart() {
  const e = state.evals;
  openDialog('Start evals', `<p>Every eval runs ${e.runsPerTask} times through the unattended pipeline, and each run is graded. A full pipeline run costs a few dollars.</p><label>Eval <select id="evalsTask"><option value="">all evals</option>${e.tasks.map((t) => `<option>${esc(t)}</option>`).join('')}</select></label>`,
    [['Start', 'primary', () => act({ kind: 'evals', task: $('evalsTask').value || undefined }), 'flows evals [task] --yes']], 'Cancel');
}

function openRuns(row) {
  const run = (r) => `<p><b>Run ${r.run}: ${r.accepted ? 'accepted' : 'not accepted'}</b><br><span class="dim">${esc(r.reason)} · ${dollars(r.costUsd)} · ${Math.round(r.durationS / 60)} min</span></p>${r.grading ? `<pre>${esc(r.grading)}</pre>` : ''}`;
  openDialog(row.task, row.runs.map(run).join(''), [], 'Close');
}

// The improve agent's proposals are markdown: headings, paragraphs, lists, tables, code blocks, `code` and **bold**. Escaped
// first, so nothing in them becomes HTML of its own.
function markdown(text) {
  const inline = (t) => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
  const out = [];
  let para = [], list, code, table;
  const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => inline(c.trim()));
  const flush = () => {
    if (table) {
      const [head, , ...body] = table;
      out.push(`<table><tr>${cells(head).map((c) => `<th>${c}</th>`).join('')}</tr>${body.map((row) => `<tr>${cells(row).map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`);
      table = undefined;
    }
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`); // the agent writes **Why:**, **File:** … on lines of their own
    para = [];
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
    list = undefined;
  };
  for (const line of String(text ?? '').split('\n')) {
    if (code) {
      if (/^\s*```/.test(line)) { out.push(`<pre>${esc(code.join('\n'))}</pre>`); code = undefined; } else code.push(line);
      continue;
    }
    const fence = /^\s*```/.test(line), heading = /^(#{1,6})\s+(.*)$/.exec(line), item = /^\s*(?:([-*])|(\d+)\.)\s+(.*)$/.exec(line);
    if (/^\s*\|/.test(line)) {
      if (!table) flush();
      (table ??= []).push(line);
      continue;
    }
    if (table) flush();
    if (fence) { flush(); code = []; }
    else if (heading) { flush(); out.push(`<h4 class="h${heading[1].length}">${inline(heading[2])}</h4>`); }
    else if (item) {
      const tag = item[1] ? 'ul' : 'ol';
      if (para.length || (list && list.tag !== tag)) flush();
      list ??= { tag, items: [] };
      list.items.push(item[3]);
    } else if (!line.trim()) flush();
    else if (list && /^\s+/.test(line)) list.items[list.items.length - 1] += ` ${line.trim()}`;
    else { if (list) flush(); para.push(line.trim()); }
  }
  if (code) out.push(`<pre>${esc(code.join('\n'))}</pre>`);
  flush();
  return out.join('');
}

// ── the commands, on hover or focus ───────────────────────────────────────────────────────────────

function showTip(el) {
  const command = el.dataset.cmd, note = el.dataset.note;
  if (!command && !note) return;
  (el.closest('dialog') ?? document.body).append(tip); // a modal dialog is above everything else: its buttons' tip goes inside it
  tip.innerHTML = (note ? `<div class="note">${esc(note)}</div>` : '') + (command ? command.split('\n').map((c) => `<code>${esc(c)}</code>`).join('') : '');
  tip.hidden = false;
  el.setAttribute('aria-describedby', 'tip');
  const r = el.getBoundingClientRect(), t = tip.getBoundingClientRect();
  const below = r.bottom + 8 + t.height < innerHeight;
  tip.style.left = `${Math.min(Math.max(8, r.left + r.width / 2 - t.width / 2), innerWidth - t.width - 8)}px`;
  tip.style.top = `${below ? r.bottom + 8 : r.top - t.height - 8}px`;
}
function hideTip() {
  tip.hidden = true;
  document.body.append(tip);
}

// The page draws parts of itself again: the tip follows what is under the pointer now
let pointer;
function retip() {
  if (tip.hidden || !pointer) return;
  const el = document.elementFromPoint(...pointer)?.closest('[data-cmd], [data-note]');
  if (el) showTip(el);
  else hideTip();
}

// ── wiring: one listener per part of the page, so it works however often the part is drawn again ─────

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => { tab = t.dataset.tab; render(); }));
document.querySelectorAll('[data-agent]').forEach((b) => b.addEventListener('click', () => b.dataset.agent !== state?.agent && act({ kind: 'agent', agent: b.dataset.agent })));
$('needs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-need]');
  if (b) openNeed(state.needs[b.dataset.need]);
});
const clickBox = (e) => {
  const el = e.target.closest('[data-box]');
  if (el) boxAction(state.boxes[el.dataset.box], Number(el.dataset.box))?.();
};
$('map').addEventListener('click', clickBox);
$('map').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    clickBox(e);
  }
});
$('loops').addEventListener('click', (e) => {
  const loop = e.target.closest('[data-loop]');
  if (loop) openTask(state.loops[loop.dataset.loop].task);
  if (e.target.closest('#implement')) pickTask();
});
$('evalsView').addEventListener('click', (e) => {
  const kind = e.target.closest('[data-kind]');
  if (kind) { evalsKind = kind.dataset.kind; render(); }
  const row = e.target.closest('[data-row]');
  if (row) openRuns(state.evals.latest[row.dataset.row]);
  const b = e.target.closest('[data-do]');
  const what = b?.dataset.do;
  if (what === 'startEvals') openEvalsStart();
  if (what === 'startSkills') act({ kind: 'skillLoadedEvals' });
  if (what === 'proposals') {
    // the latest evals' proposals, or with data-trend those of an end-to-end evals in the trend
    const skills = b.dataset.which === 'skills';
    const earlier = b.dataset.trend === undefined ? undefined : state.evals.trend[b.dataset.trend];
    const text = earlier ? earlier.proposals : state.evals.proposals[skills ? 'skills' : 'e2e'];
    const title = skills ? 'Proposal' : earlier ? `Proposals of the evals of ${earlier.label}` : 'Proposals';
    const after = skills ? 'Agents may not change .agents/: make the changes you agree with, then run the skill-loaded evals again. No commit needed.' : 'Make the ones you agree with and commit: the next evals shows whether they helped.';
    openDialog(title, `<div class="md">${markdown(text)}</div><p class="dim">${after}</p>`, [], 'Close');
    $('dialog').classList.add('wide');
  }
});
for (const [on, off] of [['mouseover', 'mouseout'], ['focusin', 'focusout']]) {
  document.addEventListener(on, (e) => { const el = e.target.closest?.('[data-cmd], [data-note]'); if (el) showTip(el); });
  document.addEventListener(off, (e) => { if (e.target.closest?.('[data-cmd], [data-note]')) hideTip(); });
}
addEventListener('mousemove', (e) => (pointer = [e.clientX, e.clientY]));
addEventListener('scroll', hideTip, true);
addEventListener('resize', () => state && tab === 'pipeline' && drawArcs());
document.addEventListener('visibilitychange', refresh);
refresh();
setInterval(refresh, 1500); // as often as the server reads the state, see REFRESH in index.ts
