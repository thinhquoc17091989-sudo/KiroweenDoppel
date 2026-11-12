import sampleText from '../samples/plant-watering/proposals.puml?raw';
import type { Model } from './core/model';
import { parse, print } from './core/puml';
import { arrangeAll, mergeLayout, type Layout } from './core/layout';
import { accept, approvedOnly, refreshLinkStatus, reject, rename } from './core/review';
import { render } from './ui/render';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const svg = $('#canvas') as unknown as SVGSVGElement;

interface State { model: Model; layout: Layout; selected: string | null }

function loadSample(): Model {
  const m = parse(sampleText);
  // Everything in proposals.puml is a proposal unless the file says otherwise.
  return refreshLinkStatus({ ...m, elements: m.elements.map((e) => ({ ...e, status: 'proposed' as const })) });
}

const LS_KEY = 'doppel.layout.plant-watering';
function savedLayout(): Layout {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') as Layout; } catch { return {}; }
}
function persistLayout(l: Layout) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(l)); } catch { /* private window: fine */ }
}

const state: State = { model: loadSample(), layout: {}, selected: null };
state.layout = mergeLayout(state.model, savedLayout());

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
$('#btnReset').addEventListener('click', () => { state.selected = null; state.layout = {}; persistLayout({}); setModel(loadSample()); toast('sample reloaded'); });
$('#btnApprove').addEventListener('click', async () => {
  const approved = approvedOnly(state.model);
  if (!approved.elements.length) { toast('accept at least one element first'); return; }
  const text = print(approved);
  const fileName = `${state.model.title || 'architecture'}.puml`;
  const layoutText = JSON.stringify(Object.fromEntries(approved.elements.map((e) => [e.id, state.layout[e.id]])), null, 2);
  const w = window as unknown as { showDirectoryPicker?: (o?: object) => Promise<FileSystemDirectoryHandle> };
  if (w.showDirectoryPicker) {
    try {
      const root = await w.showDirectoryPicker({ mode: 'readwrite' });
      const dir = await root.getDirectoryHandle('architecture', { create: true });
      await writeFile(dir, fileName, text);
      await writeFile(dir, 'layout.json', layoutText);
      toast(`wrote architecture/${fileName} and layout.json`);
      return;
    } catch (err) { if ((err as Error).name === 'AbortError') return; console.warn(err); }
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

draw();
