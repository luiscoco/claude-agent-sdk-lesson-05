import './style.css';
import './course-theme.css';
import './course-theme.js';
import { renderMarkdown } from './markdown.js';
import { createEventParser } from '../shared/sse.js';
import {
  DEFAULT_CONFIG,
  SCENARIOS,
  TOOLS,
  GUIDE,
  QUIZ,
  type Scenario,
  type Config,
  type Metadata,
  type Event,
  type Approval,
  type Report,
} from '../shared/lesson.js';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const text = (id: string, value: string) => {
  $(id).textContent = value;
};
// Model output is rendered as Markdown; host placeholders and errors stay plain text.
function showResult(value: string, markdown = false) {
  if (markdown) renderMarkdown($('result'), value);
  else text('result', value);
  $('result').classList.toggle('markdown', markdown);
}
let scenario: Scenario = 'read';
let running = false;
let controller: AbortController | undefined;
let events: Event[] = [];
let report: Report | undefined;
let submitted: Config | undefined;
let submittedMode = 'local';
const approvals = new Map<string, HTMLElement>();
function notice(message = '') {
  text('notice', message);
  $('notice').hidden = !message;
}
async function api<T>(path: string, input?: unknown): Promise<T> {
  const response = await fetch(
    path,
    input === undefined
      ? { cache: 'no-store' }
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        },
  );
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || 'Request failed.');
  return value;
}
function config(): Config {
  return {
    scenario,
    permissionMode: $<HTMLSelectElement>('permission-mode').value as Config['permissionMode'],
    title: $<HTMLInputElement>('note-title').value,
    body: $<HTMLTextAreaElement>('note-body').value,
  };
}
function selectScenario(next: Scenario) {
  scenario = next;
  $('note-inputs').hidden = next !== 'note';
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-scenario]'))
    button.setAttribute('aria-pressed', String(button.dataset.scenario === next));
}
for (const [key, item] of Object.entries(SCENARIOS)) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'scenario-card';
  button.dataset.scenario = key;
  const title = document.createElement('strong');
  title.textContent = item.title;
  const detail = document.createElement('span');
  detail.textContent = item.description;
  button.append(title, detail);
  button.addEventListener('click', () => selectScenario(key as Scenario));
  $('scenarios').append(button);
}
for (const tool of TOOLS) {
  const row = document.createElement('article');
  row.className = 'tool-row';
  const group = document.createElement('span');
  group.className = `policy-badge ${tool.policy}`;
  group.textContent = tool.policy.toUpperCase();
  const content = document.createElement('div');
  const name = document.createElement('h3');
  name.textContent = tool.name;
  const detail = document.createElement('p');
  detail.textContent = tool.effect;
  const schema = document.createElement('code');
  schema.textContent = tool.schema;
  content.append(name, detail, schema);
  row.append(group, content);
  $('tool-rows').append(row);
}
function refreshApprovals() {
  text(
    'approval-status',
    approvals.size ? `${approvals.size} REQUEST PENDING` : 'NO REQUEST PENDING',
  );
  $('approval-empty').hidden = approvals.size > 0;
}
function addApproval(approval: Approval) {
  const card = document.createElement('article');
  card.className = 'approval-card';
  card.dataset.request = approval.requestId;
  const title = document.createElement('h3');
  title.textContent = approval.input.title;
  const body = document.createElement('p');
  body.textContent = approval.input.body;
  const meta = document.createElement('small');
  meta.textContent = `${approval.tool} · expires ${new Date(approval.expiresAt).toLocaleTimeString()}`;
  const actions = document.createElement('div');
  actions.className = 'approval-actions';
  for (const decision of ['deny', 'approve'] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = decision === 'approve' ? 'Approve once' : 'Deny this note';
    button.className = decision === 'approve' ? 'approve-button' : 'decline-button';
    button.addEventListener('click', async () => {
      for (const item of actions.querySelectorAll('button')) item.disabled = true;
      try {
        await api('/api/decision', {
          runId: approval.runId,
          requestId: approval.requestId,
          decision,
        });
      } catch (error) {
        notice((error as Error).message);
      }
    });
    actions.append(button);
  }
  card.append(meta, title, body, actions);
  $('approvals').append(card);
  approvals.set(approval.requestId, card);
  refreshApprovals();
  text('status', 'Awaiting approval');
  actions.querySelector<HTMLButtonElement>('button')?.focus();
}
function removeApproval(requestId: string) {
  approvals.get(requestId)?.remove();
  approvals.delete(requestId);
  refreshApprovals();
  if (running && !approvals.size) text('status', 'Running');
}
function append(event: Event) {
  events.push(event);
  if (events.length > 100) events.shift();
  const log = $('events');
  if (log.querySelector('.empty')) log.replaceChildren();
  const entry = document.createElement('article');
  entry.className = `event ${event.kind === 'error' ? 'error' : event.kind === 'message' ? 'message' : event.kind === 'host' ? 'host' : 'control'}`;
  const heading = document.createElement('b');
  heading.textContent = event.title;
  const detail = document.createElement('p');
  detail.textContent = event.detail;
  entry.append(heading, detail);
  if (event.data !== undefined) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Selected fields';
    const pre = document.createElement('pre');
    pre.textContent = JSON.stringify(event.data, null, 2);
    details.append(summary, pre);
    entry.append(details);
  }
  log.append(entry);
  while (log.children.length > 100) log.firstElementChild?.remove();
  log.scrollTop = log.scrollHeight;
  if (event.kind === 'approval') addApproval(event.data as Approval);
  if (event.kind === 'decision') removeApproval((event.data as { requestId: string }).requestId);
}
function renderReport(next: Report) {
  report = next;
  text('read-count', String(next.counters.readCalls + next.counters.searchCalls));
  text('callback-count', String(next.counters.callbackCalls));
  text('mutation-count', String(next.counters.mutations));
  showResult(next.text, true);
  text(
    'counter-detail',
    `Save handler: ${next.counters.saveCalls} · Command handler: ${next.counters.commandCalls} · SDK permission denials: ${next.permissionDenials}${next.costUsd === undefined ? '' : ` · Estimated cost: $${next.costUsd.toFixed(4)}`}`,
  );
  $('board').replaceChildren();
  if (!next.notes.length) {
    const empty = document.createElement('p');
    empty.className = 'hint';
    empty.textContent = 'No note was saved.';
    $('board').append(empty);
  }
  for (const note of next.notes) {
    const card = document.createElement('article');
    card.className = 'saved-note';
    const title = document.createElement('h4');
    title.textContent = note.title;
    const detail = document.createElement('p');
    detail.textContent = note.body;
    card.append(title, detail);
    $('board').append(card);
  }
}
function setRunning(value: boolean) {
  running = value;
  for (const item of document.querySelectorAll<
    HTMLInputElement | HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement
  >('#run-form input,#run-form textarea,#run-form select,#run-form button'))
    item.disabled = value;
  $('stop').hidden = !value;
  $<HTMLButtonElement>('stop').disabled = false;
}
function updateMode() {
  const live = $<HTMLSelectElement>('mode').value === 'live';
  text(
    'mode-label',
    live
      ? 'Live mode · real SDK permission pipeline'
      : 'Local mode · host policy router + real MCP',
  );
  text(
    'mode-explanation',
    live
      ? 'SDK permission policies and canUseTool handle the actual requests. Model charges apply; credentials stay on the server.'
      : 'No model request runs. The host applies an explicit policy before dispatching real MCP calls.',
  );
  text('run', live ? 'Run live scenario' : 'Run local scenario');
}
$('mode').addEventListener('change', updateMode);
$('run-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (running) return;
  submitted = config();
  submittedMode = $<HTMLSelectElement>('mode').value;
  events = [];
  report = undefined;
  $('events').replaceChildren();
  for (const card of approvals.values()) card.remove();
  approvals.clear();
  refreshApprovals();
  text('status', 'Running');
  text('result-label', submittedMode === 'live' ? 'REAL SDK RUN' : 'LOCAL HOST POLICY ROUTER');
  showResult('Waiting for the scenario outcome…');
  for (const id of ['read-count', 'callback-count', 'mutation-count']) text(id, '0');
  text('counter-detail', 'Counters are finalized when the run ends.');
  $('board').replaceChildren();
  text('board', 'No note saved in this new run.');
  $<HTMLButtonElement>('export').disabled = true;
  controller = new AbortController();
  setRunning(true);
  notice();
  try {
    const response = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: submittedMode, config: submitted }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Run failed.');
    }
    if (!response.body) throw new Error('The response has no event stream.');
    let finished = false;
    const parse = createEventParser((value) => {
      const event = value as Event;
      append(event);
      if (event.kind === 'result') renderReport(event.data as Report);
      if (event.kind === 'error') {
        showResult(event.detail);
        text('status', 'Failed');
      }
      if (event.kind === 'done') {
        finished = true;
        text(
          'status',
          event.detail === 'success'
            ? 'Completed'
            : event.detail === 'cancelled'
              ? 'Cancelled'
              : 'Failed',
        );
      }
    });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      parse(decoder.decode(part.value, { stream: true }));
    }
    parse(decoder.decode());
    if (!finished) throw new Error('The connection ended without a final status.');
  } catch (error) {
    const cancelled = controller.signal.aborted;
    const detail = cancelled
      ? 'The run was cancelled; pending approvals and grants are closed.'
      : (error as Error).message;
    text('status', cancelled ? 'Cancelled' : 'Failed');
    showResult(detail);
    append({ kind: 'error', title: cancelled ? 'Cancelled' : 'Run failed', detail });
  } finally {
    if (!report) {
      for (const id of ['read-count', 'callback-count', 'mutation-count']) text(id, '—');
      text(
        'counter-detail',
        'No final execution report received. An interrupted stream does not prove that no handler ran.',
      );
      text('board', 'No final review-board snapshot was received.');
    }
    for (const card of approvals.values()) card.remove();
    approvals.clear();
    refreshApprovals();
    setRunning(false);
    controller = undefined;
    $<HTMLButtonElement>('export').disabled = false;
  }
});
$('stop').addEventListener('click', () => controller?.abort());
$('export').addEventListener('click', () => {
  const url = URL.createObjectURL(
    new Blob(
      [
        JSON.stringify(
          { lesson: 5, mode: submittedMode, config: submitted, events, report },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    ),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'lesson-05-tool-policy-trace.json';
  link.click();
  URL.revokeObjectURL(url);
});
let loadedSource = false;
$('source-details').addEventListener('toggle', () => {
  if (!$<HTMLDetailsElement>('source-details').open || loadedSource) return;
  loadedSource = true;
  void api<{ filename: string; content: string }>('/api/source')
    .then((source) => text('source', source.content))
    .catch((error) => {
      loadedSource = false;
      text('source', error.message);
    });
});
for (const item of GUIDE) {
  const card = document.createElement('article');
  card.className = 'panel method-card';
  const group = document.createElement('small');
  group.textContent = item.group;
  const title = document.createElement('h3');
  title.textContent = item.name;
  const detail = document.createElement('p');
  detail.textContent = item.text;
  card.append(group, title, detail);
  $('guide-cards').append(card);
}
const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role=tab]')];
tabs.forEach((tab, index) => {
  tab.addEventListener('click', () => {
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
      $(item.getAttribute('aria-controls')!).hidden = !selected;
    }
  });
  tab.addEventListener('keydown', (event) => {
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index + tabs.length - 1) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : null;
    if (next !== null) {
      event.preventDefault();
      tabs[next]!.click();
      tabs[next]!.focus();
    }
  });
});
QUIZ.forEach((item, index) => {
  const field = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = `${index + 1}. ${item.question}`;
  field.append(legend);
  item.answers.forEach((answer, choice) => {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = `q${index}`;
    input.value = String(choice);
    input.required = true;
    label.append(input, document.createTextNode(answer));
    field.append(label);
  });
  $('questions').append(field);
});
$('quiz-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const values = new FormData($<HTMLFormElement>('quiz-form'));
  const score = QUIZ.filter(
    (item, index) => Number(values.get(`q${index}`)) === item.correct,
  ).length;
  text(
    'quiz-score',
    `${score} / ${QUIZ.length} correct${score === QUIZ.length ? ' · You understand the policy distinctions.' : ' · Revisit the guide and try again.'}`,
  );
});
selectScenario(DEFAULT_CONFIG.scenario);
void api<Metadata>('/api/meta')
  .then((meta) => {
    text('key-status', meta.liveAvailable ? 'LIVE KEY CONFIGURED' : 'LOCAL MODE READY');
    text(
      'live-note',
      meta.liveAvailable
        ? `Live is available with ${meta.model}. Your key stays on the server.`
        : 'Live requires your own server-side ANTHROPIC_API_KEY. Local mode is ready without a key.',
    );
    $<HTMLSelectElement>('mode').options[1]!.disabled = !meta.liveAvailable;
    for (const family of meta.builtinFamilies) {
      const card = document.createElement('article');
      card.className = 'family-card';
      const title = document.createElement('h3');
      title.textContent = family.family;
      const names = document.createElement('p');
      names.textContent = family.names.join(' · ');
      const note = document.createElement('small');
      note.textContent = 'Installed SDK names · not enabled in this lab';
      card.append(title, names, note);
      $('builtin-families').append(card);
    }
  })
  .catch((error) => notice(error.message));
window.addEventListener('pagehide', () => controller?.abort());
