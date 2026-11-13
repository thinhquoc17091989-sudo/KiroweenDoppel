/**
 * Dev console front end. Imports the SAME core and UI modules the real product uses
 * (src/core/puml.ts, src/core/layout.ts, src/ui/render.ts) rather than re-implementing any
 * parsing or drawing — the whole point is that what you see here is provably what Doppel's
 * own code thinks the architecture is, not a second opinion that could drift from it.
 * Read-only: no accept/rename/reject here, that is the real review page's job
 * (run-doppel.bat / index.html). This page is for a fast glance after a Kiro run.
 */
import { parse } from '../src/core/puml';
import { arrangeAll } from '../src/core/layout';
import { refreshLinkStatus } from '../src/core/review';
import { render } from '../src/ui/render';
import type { Model } from '../src/core/model';

interface TraceEntry { id: string; name: string; req: string[]; state: string; codePath?: string; testPath?: string }
interface TraceRow { id: string; codePath: string }
interface ApiFile { name: string; text: string }
interface ApiState {
  ok: boolean; error?: string; models?: string[];
  architectureFiles: ApiFile[]; proposalsFile: ApiFile | null;
  entries: TraceEntry[]; orphans: TraceRow[]; elementCount: number;
}
interface RunResult {
  ok: boolean; error?: string;
  kiro?: { ok: boolean; output: string };
  synced?: string[];
  state: ApiState;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!));
const noHandlers = { onSelect() {}, onRename() {}, onDragStart() {} };

/** Everything in proposals.puml reads as a pending decision, the same convention
 *  src/main.ts's loadSample() uses for the real review page. */
function asProposals(m: Model): Model {
  return refreshLinkStatus({ ...m, elements: m.elements.map((e) => ({ ...e, status: 'proposed' as const })) });
}

/** Several approved architecture files shown as one diagram. A real multi-file merge (one
 *  element spanning files, a shared layout) is tracked as its own task (11b) for the real
 *  review page; this is only ever a read-only glance, so concatenation is enough here. */
function mergeArchitecture(files: ApiFile[]): Model {
  const merged: Model = { title: files.map((f) => f.name).join(' + ') || 'architecture', elements: [], links: [], notes: [] };
  for (const f of files) {
    const m = parse(f.text);
    merged.elements.push(...m.elements);
    merged.links.push(...m.links);
    merged.notes.push(...m.notes);
  }
  return merged;
}

function drawDiagram(svgId: string, emptyId: string, model: Model | null) {
  const svg = $(svgId) as unknown as SVGSVGElement;
  const empty = $(emptyId);
  if (!model || !model.elements.length) {
    svg.replaceChildren();
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';
  const layout = arrangeAll(model);
  render(svg, model, layout, null, noHandlers);
}

function badge(state: string) {
  const label = state === 'in-sync' ? 'in sync' : state === 'stale' ? 'stale' : 'no code';
  return `<span class="badge ${state}">${label}</span>`;
}

function renderPanels(data: ApiState) {
  $('archCount').textContent = `· ${data.architectureFiles.length} file(s), ${data.elementCount} element(s)`;
  drawDiagram('architectureSvg', 'architectureEmpty', data.architectureFiles.length ? mergeArchitecture(data.architectureFiles) : null);

  $('proposalsCount').textContent = data.proposalsFile ? `· ${data.proposalsFile.name}` : '· none';
  drawDiagram('proposalsSvg', 'proposalsEmpty', data.proposalsFile ? asProposals(parse(data.proposalsFile.text)) : null);

  $('traceCount').textContent = `· ${data.entries.length}`;
  $('traceBody').innerHTML = data.entries.length
    ? data.entries.map((e) => `<tr>
        <td class="mono">${esc(e.id)}</td><td class="mono">${esc((e.req || []).join(' '))}</td>
        <td>${badge(e.state)}</td><td class="mono">${esc(e.codePath || '—')}</td><td class="mono">${esc(e.testPath || '—')}</td>
      </tr>`).join('')
    : '<tr><td colspan="5" class="empty">no elements yet</td></tr>';

  $('orphans').innerHTML = data.orphans.length
    ? '<table><thead><tr><th>Id</th><th>Code</th></tr></thead><tbody>' +
      data.orphans.map((o) => `<tr><td class="mono">${esc(o.id)}</td><td class="mono">${esc(o.codePath)}</td></tr>`).join('') +
      '</tbody></table>'
    : '<div class="empty">none</div>';
}

async function loadState() {
  const r = await fetch('/api/state');
  const data = (await r.json()) as ApiState;
  if (!data.ok) { $('status').textContent = 'error loading state: ' + data.error; return; }
  const modelSel = $<HTMLSelectElement>('model');
  if (!modelSel.options.length && data.models) {
    modelSel.innerHTML = data.models.map((m) => `<option${m === 'claude-sonnet-5.5' ? ' selected' : ''}>${m}</option>`).join('');
  }
  renderPanels(data);
}

async function runTask() {
  const task = $<HTMLTextAreaElement>('task').value.trim();
  if (!task) { $('status').textContent = 'type a task description first'; return; }
  const model = $<HTMLSelectElement>('model').value;
  const runBtn = $<HTMLButtonElement>('runBtn');
  runBtn.disabled = true;
  $('status').textContent = `running on ${model}… this can take a while, especially on a stronger model`;
  $('status').classList.add('busy');
  try {
    const r = await fetch('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task, model }) });
    const data = (await r.json()) as RunResult;
    if (!data.ok) { $('status').textContent = 'error: ' + data.error; return; }
    const synced = data.synced ?? [];
    $('kiroOutput').textContent = (data.kiro?.output || '(no output)') +
      (synced.length ? `\n\n[dev console] trace.json synced for: ${synced.join(', ')}` : '\n\n[dev console] nothing new synced to trace.json this run');
    renderPanels(data.state);
    $('status').textContent = data.kiro?.ok ? 'done — see the Proposals diagram for what changed' : 'Kiro exited with an error — see output above';
  } catch (err) {
    $('status').textContent = 'request failed: ' + String(err);
  } finally {
    runBtn.disabled = false;
    $('status').classList.remove('busy');
  }
}

$('runBtn').addEventListener('click', runTask);
$('refreshBtn').addEventListener('click', loadState);
loadState();
