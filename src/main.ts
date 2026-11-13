import bundledSampleText from '../samples/plant-watering/proposals.puml?raw';
import { emptyModel, type Model } from './core/model';
import { parse, print } from './core/puml';
import { arrangeAll, mergeLayout, type Layout } from './core/layout';
import { accept, approvedOnly, refreshLinkStatus, reject, rename } from './core/review';
import { isApprovedArchitectureFile } from './core/trace';
import { render } from './ui/render';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const svg = $('#canvas') as unknown as SVGSVGElement;
const svgApproved = $('#canvasApproved') as unknown as SVGSVGElement;

interface State { model: Model; layout: Layout; selected: string | null; compareOn: boolean; source: string }

/** Everything in a proposals file is a pending decision, whatever the file itself says. */
function asProposals(m: Model): Model {
  return refreshLinkStatus({ ...m, elements: m.elements.map((e) => ({ ...e, status: 'proposed' as const })) });
}

/**
 * Two ways this page gets its data, and it must work both ways:
 *  - **served by the local tool** (`npx doppel`): /api/state returns the HOST project's own
 *    proposals file, so Doppel dropped into someone else's repo shows THEIR architecture.
 *  - **static hosting** (GitHub Pages, no server): that fetch fails, and the bundled
 *    plant-watering sample is used so the public demo still works for anyone clicking a link.
 * The page says which one it is, because silently showing a sample while a reviewer believes
 * they are looking at their own project would be the worst possible failure here.
 */
async function loadProject(): Promise<{ model: Model; source: string }> {
  try {
    const res = await fetch('/api/state');
    // A static host does not 404 this: it serves index.html with a 200 (SPA fallback), so
    // the content type is what actually distinguishes "no server" from "real API", not the
    // status code. Checked explicitly rather than relying on res.json() throwing on HTML.
    const isJson = res.headers.get('content-type')?.includes('application/json');
    if (res.ok && isJson) {
      const data = await res.json() as { ok?: boolean; proposalsFile?: { name: string; text: string } | null };
      if (data.ok && data.proposalsFile) {
        return { model: asProposals(parse(data.proposalsFile.text)), source: data.proposalsFile.name };
      }
      if (data.ok) return { model: emptyModel(), source: 'no proposals file in this project yet' };
    }
  } catch {
    // no local server: static hosting, fall through to the bundled sample
  }
  return { model: asProposals(parse(bundledSampleText)), source: 'bundled sample (no project server)' };
}

// Layout is keyed by the diagram title, not a fixed string: two different projects opened in
// the same browser must not inherit each other's element positions.
const lsKey = (title: string) => `doppel.layout.${title || 'untitled'}`;
function savedLayout(title: string): Layout {
  try { return JSON.parse(localStorage.getItem(lsKey(title)) ?? '{}') as Layout; } catch { return {}; }
}
function persistLayout(l: Layout) {
  try { localStorage.setItem(lsKey(state.model.title), JSON.stringify(l)); } catch { /* private window: fine */ }
}

const state: State = { model: emptyModel(), layout: {}, selected: null, compareOn: false, source: 'loading…' };

// Held across actions once granted, so Approve, then Compare, then Approve again never
// re-prompts the folder picker mid-session -- one grant covers the whole working session.
let projectDir: FileSystemDirectoryHandle | null = null;

async function getProjectDir(): Promise<FileSystemDirectoryHandle | null> {
  if (projectDir) return projectDir;
  const w = window as unknown as { showDirectoryPicker?: (o?: object) => Promise<FileSystemDirectoryHandle> };
  if (!w.showDirectoryPicker) return null;
  try {
    projectDir = await w.showDirectoryPicker({ mode: 'readwrite' });
    return projectDir;
  } catch (err) {
    if ((err as Error).name !== 'AbortError') console.warn(err);
    return null;
  }
}

/** Every *.puml under architecture/, merged into one Model. Null means "no folder chosen
 *  or the user cancelled"; an empty Model (no elements) means "folder chosen, nothing
 *  approved there yet" -- callers tell these apart to show the right empty state. */
async function loadApprovedArchitecture(dir: FileSystemDirectoryHandle): Promise<Model> {
  const merged: Model = { title: 'architecture', elements: [], links: [], notes: [] };
  let archDir: FileSystemDirectoryHandle;
  try {
    archDir = await dir.getDirectoryHandle('architecture');
  } catch {
    return merged; // no architecture/ folder yet: nothing approved, not an error
  }
  const anyDir = archDir as unknown as { values(): AsyncIterable<FileSystemHandle> };
  for await (const entry of anyDir.values()) {
    if (entry.kind !== 'file' || !isApprovedArchitectureFile(entry.name)) continue;
    const fh = entry as FileSystemFileHandle;
    const file = await fh.getFile();
    const text = await file.text();
    const m = parse(text);
    merged.elements.push(...m.elements);
    merged.links.push(...m.links);
    merged.notes.push(...m.notes);
  }
  return merged;
}

function toast(msg: string) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('on');
  setTimeout(() => t.classList.remove('on'), 1800);
}

function setModel(m: Model) {
  state.model = m;
  state.layout = mergeLayout(m, state.layout);
  persistLayout(state.layout);
  draw();
}

function listItem(e: Model['elements'][number]): HTMLLIElement {
  const li = document.createElement('li');
  if (state.selected === e.id) li.classList.add('hl');
  const info = document.createElement('div');
  info.innerHTML = `<div class="name"></div><div class="meta"></div>`;
  (info.querySelector('.name') as HTMLElement).textContent = e.name;
  (info.querySelector('.meta') as HTMLElement).textContent = `${e.kind} · id ${e.id}${e.req.length ? ' · ' + e.req.join(' ') : ''}`;
  const actions = document.createElement('div');
  actions.className = 'actions';
  const btn = (label: string, cls: string, fn: () => void, title: string) => {
    const b = document.createElement('button');
    b.textContent = label; b.className = `small ${cls}`; b.title = title;
    b.addEventListener('click', (ev) => { ev.stopPropagation(); fn(); });
    actions.append(b);
  };
  if (e.status === 'proposed' || e.status === 'modified') {
    btn('Accept', 'ok', () => { setModel(accept(state.model, e.id)); toast(`${e.name} approved`); }, 'Approve this element');
  }
  btn('Rename', '', () => doRename(e.id), 'Rename, the id stays the same');
  btn('Reject', 'warn', () => { setModel(reject(state.model, e.id)); toast(`${e.name} removed`); }, 'Remove this element and its links');
  li.append(info, actions);
  li.addEventListener('click', () => { state.selected = e.id; draw(); });
  return li;
}

function fillList(sel: string, countSel: string, items: Model['elements']) {
  const ul = $(sel);
  ul.replaceChildren(...items.map(listItem));
  if (!items.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'none'; ul.append(li); }
  $(countSel).textContent = String(items.length);
}

function draw() {
  render(svg, state.model, state.layout, state.selected, { onSelect, onRename: doRename, onDragStart });
  // 'modified' sits in the Proposed list too: like a new proposal, it still awaits a
  // decision, even though approvedOnly() already ships its current content either way.
  fillList('#listProposed', '#countProposed', state.model.elements.filter((e) => e.status === 'proposed' || e.status === 'modified'));
  fillList('#listApproved', '#countApproved', state.model.elements.filter((e) => e.status === 'approved'));
  $('#puml').textContent = print(state.model);
  $('#source').textContent = state.source;
}

async function refreshCompare() {
  if (!state.compareOn) return;
  const empty = $('#approvedEmpty');
  const dir = await getProjectDir();
  if (!dir) {
    svgApproved.replaceChildren();
    empty.textContent = 'this browser, or you, declined folder access — Chromium-based browsers only';
    empty.style.display = 'flex';
    return;
  }
  const approved = await loadApprovedArchitecture(dir);
  if (!approved.elements.length) {
    svgApproved.replaceChildren();
    empty.textContent = 'nothing approved in this project yet';
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';
  render(svgApproved, approved, arrangeAll(approved), null, { onSelect() {}, onRename() {}, onDragStart() {} });
}

function onSelect(id: string) { state.selected = id; draw(); }

function doRename(id: string) {
  const e = state.model.elements.find((x) => x.id === id);
  if (!e) return;
  const name = window.prompt(`Rename "${e.name}" (id ${e.id} stays the same)`, e.name);
  if (name && name.trim() && name.trim() !== e.name) { setModel(rename(state.model, id, name)); toast(`renamed, id ${e.id} kept`); }
}

// drag
function onDragStart(id: string, ev: PointerEvent) {
  ev.preventDefault();
  const start = state.layout[id];
  if (!start) return;
  const g = (ev.currentTarget as SVGGElement);
  g.classList.add('dragging');
  const pt0 = clientToSvg(ev.clientX, ev.clientY);
  const origin = { ...start };
  const move = (e: PointerEvent) => {
    const pt = clientToSvg(e.clientX, e.clientY);
    state.layout[id] = { x: Math.round((origin.x + pt.x - pt0.x) / 8) * 8, y: Math.round((origin.y + pt.y - pt0.y) / 8) * 8 };
    render(svg, state.model, state.layout, state.selected, { onSelect, onRename: doRename, onDragStart });
  };
  const up = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    persistLayout(state.layout); draw();
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
}
function clientToSvg(cx: number, cy: number) {
  const pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy;
  const ctm = svg.getScreenCTM();
  return ctm ? pt.matrixTransform(ctm.inverse()) : { x: cx, y: cy };
}

// header buttons
$('#btnArrange').addEventListener('click', () => { state.layout = arrangeAll(state.model); persistLayout(state.layout); draw(); });
$('#btnReset').addEventListener('click', async () => {
  // Re-reads from whatever this page is actually backed by (the host project, or the
  // bundled sample), not always the sample -- discarding positions as it goes.
  state.selected = null;
  state.layout = {};
  const { model, source } = await loadProject();
  state.source = source;
  persistLayout({});
  setModel(model);
  toast(`reloaded from ${source}`);
});
$('#btnCompare').addEventListener('click', async () => {
  state.compareOn = !state.compareOn;
  $('#btnCompare').classList.toggle('on', state.compareOn);
  $('#paneApproved').hidden = !state.compareOn;
  if (state.compareOn) await refreshCompare();
});
$('#btnApprove').addEventListener('click', async () => {
  const approved = approvedOnly(state.model);
  if (!approved.elements.length) { toast('accept at least one element first'); return; }
  const text = print(approved);
  const fileName = `${state.model.title || 'architecture'}.puml`;
  const layoutText = JSON.stringify(Object.fromEntries(approved.elements.map((e) => [e.id, state.layout[e.id]])), null, 2);
  const root = await getProjectDir();
  if (root) {
    try {
      const dir = await root.getDirectoryHandle('architecture', { create: true });
      await writeFile(dir, fileName, text);
      await writeFile(dir, 'layout.json', layoutText);
      toast(`wrote architecture/${fileName} and layout.json`);
      if (state.compareOn) await refreshCompare(); // the diagram you just wrote should show up on its own side immediately
      return;
    } catch (err) { console.warn(err); }
  }
  await navigator.clipboard?.writeText(text).catch(() => undefined);
  download(fileName, text);
  toast('downloaded and copied to clipboard');
});

async function writeFile(dir: FileSystemDirectoryHandle, name: string, content: string) {
  const fh = await dir.getFileHandle(name, { create: true });
  const ws = await (fh as unknown as { createWritable(): Promise<{ write(s: string): Promise<void>; close(): Promise<void> }> }).createWritable();
  await ws.write(content); await ws.close();
}
function download(name: string, content: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain' })); a.download = name; a.click();
  URL.revokeObjectURL(a.href);
}

async function init() {
  draw(); // paint the shell immediately so the page is never blank while the fetch resolves
  const { model, source } = await loadProject();
  state.source = source;
  state.model = model;
  state.layout = mergeLayout(model, savedLayout(model.title));
  draw();
}

void init();
