import bundledSampleText from '../samples/plant-watering/proposals.puml?raw';
import { emptyModel, type Model } from './core/model.ts';
import { parse, print } from './core/puml.ts';
import { arrangeAll, mergeLayout, type Layout } from './core/layout.ts';
import { acceptAll, approvedOnly, refreshLinkStatus, rename, setDescription } from './core/review.ts';
import { isApprovedArchitectureFile } from './core/trace.ts';
import { archPath, defaultTarget, normaliseTarget, slug, type Dialect } from './core/paths.ts';
import { render } from './ui/render.ts';
import type { RouteStyle } from './core/route.ts';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const svg = $('#canvas') as unknown as SVGSVGElement;
const svgApproved = $('#canvasApproved') as unknown as SVGSVGElement;
const noHandlers = { onSelect() {}, onRename() {}, onDragStart() {} };

/**
 * One file the reviewer can open. The proposals file is the only editable one — accept,
 * rename and reject all act on it. Approved architecture files are read-only here, because
 * editing them directly would bypass the review step this tool exists to provide.
 */
interface OpenFile {
  name: string;   // path as the project sees it, e.g. "architecture/plant-watering.puml"
  label: string;  // what the tab and tree show
  model: Model;
  layout: Layout;
  /** True once the reviewer drags something. Positions are otherwise derived from the
   *  .puml itself, so nothing needs storing — see persistLayout for why that matters. */
  layoutDirty: boolean;
  editable: boolean;
  kind: 'proposals' | 'approved';
  /** Folder under architecture/; empty for a file sitting directly in it. */
  feature: string;
  /** static, or the dynamic view this file holds, read off the filename suffix. */
  dialect: Dialect;
}

interface State {
  files: OpenFile[];
  openTabs: string[];
  activeName: string | null;
  selected: string | null;
  compareOn: boolean;
  source: string;
  routeStyle: RouteStyle;
  /** Which of the two right-panel tabs is showing. Selecting an element always switches
   *  here to 'inspector', since that is the whole point of selecting something. */
  rightTab: 'inspector' | 'puml';
  filterText: string;
  filterStatus: StatusFilter;
  /** Group the tree by feature folder, or by literal path. Same files either way. */
  groupMode: 'feature' | 'folder';
  collapsed: Set<string>;
  /** Where Approve writes, relative to architecture/. Null until a proposals file loads. */
  target: string | null;
  /** Per-element drift from the server's trace, used to mark a file stale in the tree. */
  drift: Record<string, 'in-sync' | 'stale' | 'no-code'>;
}

type StatusFilter = 'all' | 'proposed' | 'modified' | 'approved';

const state: State = { files: [], openTabs: [], activeName: null, selected: null, compareOn: false, source: 'loading…', routeStyle: 'free', rightTab: 'inspector', filterText: '', filterStatus: 'all',
  groupMode: 'feature', collapsed: new Set(), target: null, drift: {} };

const active = (): OpenFile | undefined => state.files.find((f) => f.name === state.activeName);

/** Everything in a proposals file is a pending decision, whatever the file itself says. */
function asProposals(m: Model): Model {
  return refreshLinkStatus({ ...m, elements: m.elements.map((e) => ({ ...e, status: 'proposed' as const })) });
}

/**
 * Layout is DERIVED from the .puml, not stored with it. `arrangeAll` lays a diagram out
 * from its own elements and links, so a file that nobody has dragged needs no layout data
 * at all — open it anywhere and it looks the same.
 *
 * Only once a reviewer moves something by hand is there anything worth keeping, and that
 * is kept in browser storage under a key, never written into `architecture/`. Writing a
 * layout file next to the architecture would clutter the file tree with something that is
 * not architecture, and worse, `.kiro/steering/architecture.md` pulls that whole folder in
 * for Kiro — so every approve would feed the agent a blob of pixel coordinates as if it
 * were design.
 */
const lsKey = (fileName: string) => `doppel.layout.${fileName}`;
function savedLayout(fileName: string): Layout {
  try { return JSON.parse(localStorage.getItem(lsKey(fileName)) ?? '{}') as Layout; } catch { return {}; }
}
function persistLayout(f: OpenFile) {
  if (!f.layoutDirty) return; // untouched: derivable from the .puml, nothing to store
  try { localStorage.setItem(lsKey(f.name), JSON.stringify(f.layout)); } catch { /* private window: fine */ }
}

/** A hand-picked write target, remembered per proposals file so it survives a reload. */
const targetKey = (fileName: string) => `doppel.target.${fileName}`;
const savedTarget = (fileName: string): string | null => {
  try { return localStorage.getItem(targetKey(fileName)); } catch { return null; }
};
function persistTarget(fileName: string, target: string) {
  try { localStorage.setItem(targetKey(fileName), target); } catch { /* private window: fine */ }
}

/**
 * Where approving this proposals file should write, in order of preference: a path the
 * reviewer chose by hand, then the existing diagram of the same name wherever it already
 * lives, then a new file at the top level.
 *
 * The middle step is what stops a revision of `irrigation/irrigation.puml` from landing as
 * a second, top-level `irrigation.puml` — approving a revised diagram should replace the
 * one it revises, not fork it.
 */
function pickTarget(files: OpenFile[], proposals: OpenFile): string {
  const saved = savedTarget(proposals.name);
  const cleaned = saved ? normaliseTarget(saved) : null;
  if (cleaned) return cleaned;

  const stem = slug(proposals.model.title);
  const existing = files.find((f) => f.kind === 'approved' && f.dialect === 'static' && f.label === stem);
  return existing ? archPath(existing.name).rel : defaultTarget(proposals.model.title);
}

function toFile(name: string, text: string, kind: OpenFile['kind']): OpenFile {
  const parsed = parse(text);
  const model = kind === 'proposals' ? asProposals(parsed) : parsed;
  const saved = savedLayout(name);
  const hadSaved = Object.keys(saved).length > 0;
  // A proposals file is not part of the architecture hierarchy, so it is not classified
  // by it: it has no feature folder and is always the static view under review.
  const info = archPath(name);
  return {
    name,
    label: kind === 'proposals' ? (name.split('/').pop() ?? name).replace(/\.puml$/i, '') : info.label,
    feature: kind === 'proposals' ? '' : info.feature,
    dialect: kind === 'proposals' ? 'static' : info.dialect,
    model,
    layout: hadSaved ? mergeLayout(model, saved) : arrangeAll(model),
    layoutDirty: hadSaved,
    editable: kind === 'proposals',
    kind,
  };
}

/**
 * Two ways this page gets its data, and it must work both ways:
 *  - **served by the local tool** (`npx doppel`): /api/state returns the HOST project's own
 *    files, so Doppel dropped into someone else's repo shows THEIR architecture.
 *  - **static hosting** (GitHub Pages, no server): that fetch fails and the bundled sample
 *    is used, so a public demo link still works.
 * The page says which one it is: silently showing a sample while a reviewer believes they
 * are looking at their own project would be the worst failure available here.
 */
async function loadProject(): Promise<{ files: OpenFile[]; source: string; drift: State['drift'] }> {
  try {
    const res = await fetch('/api/state');
    // A static host does not 404 this: it serves index.html with a 200 (SPA fallback), so
    // content type is what distinguishes "no server" from "real API", not the status code.
    const isJson = res.headers.get('content-type')?.includes('application/json');
    if (res.ok && isJson) {
      const data = await res.json() as {
        ok?: boolean;
        proposalsFile?: { name: string; text: string } | null;
        architectureFiles?: { name: string; text: string }[];
        entries?: { id: string; state: 'in-sync' | 'stale' | 'no-code' }[];
      };
      if (data.ok) {
        const files: OpenFile[] = [];
        if (data.proposalsFile) files.push(toFile(data.proposalsFile.name, data.proposalsFile.text, 'proposals'));
        for (const a of data.architectureFiles ?? []) {
          if (!isApprovedArchitectureFile(a.name)) continue;
          files.push(toFile(`architecture/${a.name}`, a.text, 'approved'));
        }
        const source = data.proposalsFile?.name ?? (files.length ? 'approved architecture only' : 'nothing in this project yet');
        const drift: State['drift'] = {};
        for (const e of data.entries ?? []) drift[e.id] = e.state;
        return { files, source, drift };
      }
    }
  } catch {
    // no local server: static hosting, fall through to the bundled sample
  }
  return {
    files: [toFile('samples/plant-watering/proposals.puml', bundledSampleText, 'proposals')],
    source: 'bundled sample (no project server)',
    drift: {},
  };
}

function toast(msg: string) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('on');
  setTimeout(() => t.classList.remove('on'), 1800);
}

/** Replaces the active file's model after an edit, keeping positions already chosen. */
function setModel(m: Model) {
  const f = active();
  if (!f) return;
  f.model = m;
  f.layout = mergeLayout(m, f.layout);
  persistLayout(f);
  draw();
}

// ---------------------------------------------------------------- tree and tabs

function openFile(name: string) {
  if (!state.files.some((f) => f.name === name)) return;
  if (!state.openTabs.includes(name)) state.openTabs.push(name);
  state.activeName = name;
  state.selected = null;
  // A filter carried over from another file would open this one looking half-empty.
  state.filterText = '';
  state.filterStatus = 'all';
  ($('#filterText') as HTMLInputElement).value = '';
  draw();
}

function closeTab(name: string) {
  state.openTabs = state.openTabs.filter((n) => n !== name);
  if (state.activeName === name) state.activeName = state.openTabs[state.openTabs.length - 1] ?? null;
  draw();
}

/** A file is stale when code was generated for one of its elements and has since drifted
 *  from it. 'no-code' is not drift: nothing was generated, so nothing can disagree yet. */
function isStale(f: OpenFile): boolean {
  return f.model.elements.some((e) => state.drift[e.id] === 'stale');
}

/** Title case for a folder name, so "irrigation" reads as a feature, not a path fragment. */
const featureTitle = (feature: string) => feature ? feature.charAt(0).toUpperCase() + feature.slice(1) : 'System';

/** The dot carries the file's state and nothing else; the tag beside the name carries the
 *  dialect. One job per mark, so a healthy row never says the same thing twice. */
function statusClass(f: OpenFile): string {
  if (f.kind === 'proposals') return 'prop';
  if (isStale(f)) return 'stale';
  return f.dialect === 'static' ? 'app' : 'gen';
}

function treeRow(f: OpenFile): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = `treeItem${f.name === state.activeName ? ' on' : ''}`;
  b.title = f.name; // the extension and the full path live here, not in the label

  const ic = document.createElement('i');
  ic.className = `ic ${statusClass(f)}`;
  const nm = document.createElement('span');
  nm.className = 'nm';
  nm.textContent = f.label;
  b.append(ic, nm);

  const tag = document.createElement('span');
  if (f.kind === 'proposals') {
    const pending = f.model.elements.filter((e) => e.status !== 'approved').length;
    tag.className = 'tag pending';
    tag.textContent = pending ? `${pending} pending` : 'reviewed';
  } else {
    tag.className = 'kindTag';
    tag.textContent = f.dialect;
  }
  b.append(tag);

  b.addEventListener('click', () => openFile(f.name));
  return b;
}

/** The row for a destination that has no file yet, so where Approve lands is visible
 *  before it exists rather than appearing out of nowhere after the first write. */
function ghostRow(target: string): HTMLDivElement {
  const g = document.createElement('div');
  g.className = 'ghostRow';
  g.title = `architecture/${target}`;
  const nm = document.createElement('span');
  nm.className = 'nm';
  nm.textContent = archPath(target).label;
  const tag = document.createElement('span');
  tag.className = 'tag writing';
  tag.textContent = 'writing here';
  g.append(nm, tag);
  return g;
}

function drawTree() {
  const body = $('#treeBody');
  body.replaceChildren();

  for (const btn of document.querySelectorAll<HTMLButtonElement>('#groupMode button')) {
    btn.classList.toggle('on', btn.dataset['mode'] === state.groupMode);
  }

  const approved = state.files.filter((f) => f.kind === 'approved');
  const proposals = state.files.filter((f) => f.kind === 'proposals');

  // Feature mode groups by the folder under architecture/; folder mode shows the literal
  // containing directory. The same files, read two ways.
  const keyOf = (f: OpenFile) => state.groupMode === 'feature'
    ? featureTitle(f.feature)
    : (f.name.split('/').slice(0, -1).join('/') || 'architecture');

  const groups = new Map<string, OpenFile[]>();
  for (const f of approved) {
    const k = keyOf(f);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(f);
  }

  const target = state.target;
  const targetExists = target !== null && approved.some((f) => f.name === `architecture/${target}`);
  const targetGroup = target === null ? null : state.groupMode === 'feature'
    ? featureTitle(archPath(target).feature)
    : (`architecture/${target}`.split('/').slice(0, -1).join('/') || 'architecture');
  if (targetGroup !== null && !targetExists && !groups.has(targetGroup)) groups.set(targetGroup, []);

  const section = (title: string, files: OpenFile[], extra?: HTMLElement) => {
    const collapsed = state.collapsed.has(title);
    const head = document.createElement('button');
    head.className = `treeGroup${collapsed ? ' closed' : ''}`;
    const chev = document.createElement('span');
    chev.className = 'chev';
    chev.textContent = '▾';
    const nm = document.createElement('span');
    nm.className = 'gname';
    nm.textContent = title;
    head.append(chev, nm);

    const staleCount = files.filter(isStale).length;
    if (staleCount) {
      const warn = document.createElement('span');
      warn.className = 'warn';
      warn.textContent = `${staleCount} stale`;
      head.append(warn);
    }
    const ct = document.createElement('span');
    ct.className = 'ct';
    ct.textContent = String(files.length + (extra ? 1 : 0));
    head.append(ct);
    head.addEventListener('click', () => {
      if (collapsed) state.collapsed.delete(title); else state.collapsed.add(title);
      drawTree();
    });
    body.append(head);
    if (collapsed) return;
    for (const f of files) body.append(treeRow(f));
    if (extra) body.append(extra);
  };

  for (const [title, files] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
    section(title, files, title === targetGroup && !targetExists ? ghostRow(target!) : undefined);
  }
  if (!groups.size) {
    const e = document.createElement('div');
    e.className = 'treeEmpty';
    e.textContent = 'nothing approved yet';
    body.append(e);
  }

  section('Under review', proposals);
  if (!proposals.length) {
    const e = document.createElement('div');
    e.className = 'treeEmpty';
    e.textContent = 'no proposals file';
    body.append(e);
  }

  drawCrumb();
}

/** The destination, spelled out as a path and clickable to change. */
function drawCrumb() {
  const bar = $('#crumbBar');
  const btn = $('#crumbPath');
  const f = state.files.find((x) => x.kind === 'proposals');
  bar.hidden = !f || state.target === null;
  if (!f || state.target === null) return;

  btn.replaceChildren();
  ['architecture', ...state.target.split('/')].forEach((part, i) => {
    if (i) {
      const sep = document.createElement('span');
      sep.className = 'crumbSep';
      sep.textContent = '›';
      btn.append(sep);
    }
    const sp = document.createElement('span');
    sp.className = 'crumb';
    sp.textContent = part;
    btn.append(sp);
  });
}

/** Changing the destination by hand. Anything that would climb out of architecture/,
 *  overwrite a proposals file, or not be a diagram is refused, not quietly corrected. */
function editTarget() {
  const f = state.files.find((x) => x.kind === 'proposals');
  if (!f || state.target === null) return;
  const input = window.prompt(
    'Where should Approve write, relative to architecture/?\n\nUse a folder to group a feature, e.g. irrigation/irrigation.puml',
    state.target);
  if (input === null) return;
  const next = normaliseTarget(input);
  if (!next) { toast('needs to be a .puml path inside architecture/'); return; }
  state.target = next;
  persistTarget(f.name, next);
  draw();
  toast(`approve will write architecture/${next}`);
}

function drawTabs() {
  const bar = $('#tabbar');
  bar.replaceChildren();
  for (const name of state.openTabs) {
    const f = state.files.find((x) => x.name === name);
    if (!f) continue;
    const tab = document.createElement('button');
    tab.className = `tab${name === state.activeName ? ' on' : ''}`;
    tab.innerHTML = `<i class="ic ${f.kind === 'proposals' ? 'editing' : 'approved'}"></i><span></span><span class="x">×</span>`;
    (tab.querySelector('span') as HTMLElement).textContent = f.label;
    tab.addEventListener('click', () => openFile(name));
    (tab.querySelector('.x') as HTMLElement).addEventListener('click', (ev) => { ev.stopPropagation(); closeTab(name); });
    bar.append(tab);
  }
}

// ---------------------------------------------------------------- element list

const STATUS_GROUPS = [
  { key: 'proposed', label: 'Proposed' },
  { key: 'modified', label: 'Modified' },
  { key: 'approved', label: 'Approved' },
] as const;

/** Selecting an element — from the canvas, the list, or a connection in the inspector —
 *  always means "show me its detail", so it always lands on the Inspector tab. */
function selectElement(id: string | null) {
  state.selected = id;
  state.rightTab = 'inspector';
  draw();
}

const activeModel = (): Model => active()?.model ?? emptyModel();

/**
 * One line per element: a status dot, the name, its kind, and a dot marking whether anyone
 * has described it. Writing that description happens in the detail view, so the row stays a
 * single line — which is what keeps a forty-element model readable without scrolling past
 * six of them. The full text is the row's tooltip.
 */
function listRow(e: Model['elements'][number]): HTMLElement {
  const row = document.createElement('div');
  row.className = `row${state.selected === e.id ? ' hl' : ''}`;
  if (e.desc) row.title = e.desc;

  const dot = document.createElement('span');
  dot.className = `dot ${e.status}`;
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = e.name;
  const kind = document.createElement('span');
  kind.className = `kind${e.kind === 'interface' ? ' iface' : ''}`;
  kind.textContent = e.kind;
  const hasDesc = document.createElement('span');
  hasDesc.className = `hasDesc${e.desc ? '' : ' off'}`;

  row.append(dot, name, kind, hasDesc);
  row.addEventListener('click', () => selectElement(e.id));
  return row;
}

const matchesFilter = (e: Model['elements'][number], q: string) =>
  !q || e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q);

/** Renders the filter pills and the grouped rows. Called on its own while typing in the
 *  search box, so that a keystroke never rebuilds the input it was typed into. */
function drawList() {
  const m = activeModel();
  const host = $('#elementList');
  host.replaceChildren();

  const counts: Record<StatusFilter, number> = { all: m.elements.length, proposed: 0, modified: 0, approved: 0 };
  for (const e of m.elements) counts[e.status]++;
  // A filter aimed at a group that has since emptied would hide the whole list, so it
  // falls back to All rather than leaving the reviewer staring at nothing.
  if (counts[state.filterStatus] === 0) state.filterStatus = 'all';

  for (const pill of document.querySelectorAll<HTMLButtonElement>('#filterPills .pill')) {
    const key = pill.dataset['status'] as StatusFilter;
    (pill.querySelector('i') as HTMLElement).textContent = String(counts[key]);
    pill.classList.toggle('on', state.filterStatus === key);
    pill.disabled = key !== 'all' && counts[key] === 0;
  }

  const q = state.filterText.trim().toLowerCase();
  let shown = 0;
  for (const g of STATUS_GROUPS) {
    if (state.filterStatus !== 'all' && state.filterStatus !== g.key) continue;
    const items = m.elements.filter((e) => e.status === g.key && matchesFilter(e, q));
    if (!items.length) continue;
    shown += items.length;

    const head = document.createElement('div');
    head.className = 'groupLabel';
    const label = document.createElement('span');
    label.textContent = g.label;
    const count = document.createElement('em');
    count.textContent = String(items.length);
    head.append(label, count);

    host.append(head, ...items.map(listRow));
  }

  if (!shown) {
    const empty = document.createElement('div');
    empty.className = 'listEmpty';
    empty.textContent = m.elements.length ? 'Nothing matches that filter.' : 'No elements in this file.';
    host.append(empty);
  }
}

/**
 * The detail view for one selected element: name, status, requirements, an editable
 * description, and every link touching it (clicking a connection jumps the inspector to
 * that element instead). Replaces the plain list while something is selected.
 */
function renderDetail(e: Model['elements'][number], m: Model, editable: boolean): HTMLElement {
  const root = document.createElement('div');

  const back = document.createElement('div');
  back.className = 'backRow';
  back.textContent = '← back to list';
  back.addEventListener('click', () => selectElement(null));
  root.append(back);

  const head = document.createElement('div');
  head.className = 'iHead';
  const nameWrap = document.createElement('div');
  const name = document.createElement('div');
  name.className = 'iName';
  name.textContent = e.name;
  const meta = document.createElement('div');
  meta.className = 'iMeta';
  meta.textContent = `id: ${e.id}`;
  nameWrap.append(name, meta);
  const badge = document.createElement('span');
  badge.className = `badge ${e.status}`;
  badge.textContent = e.status;
  head.append(nameWrap, badge);
  root.append(head);

  if (e.req.length) {
    const reqRow = document.createElement('div');
    reqRow.className = 'iReq';
    for (const r of e.req) {
      const span = document.createElement('span');
      span.textContent = r;
      reqRow.append(span);
    }
    root.append(reqRow);
  }

  const descLabel = document.createElement('label');
  descLabel.className = 'fieldLabel';
  descLabel.textContent = 'Description';
  root.append(descLabel);

  if (editable) {
    const textarea = document.createElement('textarea');
    textarea.className = 'descBox';
    textarea.value = e.desc;
    textarea.placeholder = 'Add a description…';
    textarea.addEventListener('keydown', (kev) => {
      if (kev.key === 'Enter' && !kev.shiftKey) { kev.preventDefault(); textarea.blur(); }
      if (kev.key === 'Escape') { kev.preventDefault(); textarea.value = e.desc; textarea.blur(); }
    });
    textarea.addEventListener('blur', () => {
      const next = textarea.value.trim();
      if (next !== e.desc) { setModel(setDescription(activeModel(), e.id, next)); toast('description saved'); }
    });
    root.append(textarea);
  } else {
    const p = document.createElement('div');
    p.className = 'descText';
    p.textContent = e.desc || '—';
    root.append(p);
  }

  const links = m.links.filter((l) => l.from === e.id || l.to === e.id);
  if (links.length) {
    const linkLabel = document.createElement('label');
    linkLabel.className = 'fieldLabel';
    linkLabel.textContent = 'Connections';
    root.append(linkLabel);
    const group = document.createElement('div');
    group.className = 'linkGroup';
    for (const l of links) {
      const outgoing = l.from === e.id;
      const otherId = outgoing ? l.to : l.from;
      const other = m.elements.find((x) => x.id === otherId);
      const row = document.createElement('div');
      row.className = 'linkRow';
      const arrow = document.createElement('span');
      arrow.className = 'arrow';
      arrow.textContent = outgoing ? '→' : '←';
      const target = document.createElement('span');
      target.className = 'target';
      target.textContent = other?.name ?? otherId;
      target.addEventListener('click', () => selectElement(otherId));
      row.append(arrow, target);
      if (l.label) {
        const lbl = document.createElement('span');
        lbl.className = 'label';
        lbl.textContent = l.label;
        row.append(lbl);
      }
      group.append(row);
    }
    root.append(group);
  }

  return root;
}

// ---------------------------------------------------------------- drawing

function draw() {
  drawTree();
  drawTabs();

  const f = active();
  const m = f?.model ?? emptyModel();
  const empty = $('#canvasEmpty');

  if (!f) {
    svg.replaceChildren();
    empty.textContent = state.files.length ? 'Pick a file on the left.' : 'Nothing to show for this project yet.';
    empty.hidden = false;
  } else {
    empty.hidden = true;
    render(svg, m, f.layout, state.selected,
      f.editable
        ? { onSelect, onRename: doRename, onDragStart, onNoteDragStart }
        : noHandlers,
      state.routeStyle);
  }

  $('#readonlyNote').hidden = !f || f.editable;

  $('#tabInspector').classList.toggle('on', state.rightTab === 'inspector');
  $('#tabPuml').classList.toggle('on', state.rightTab === 'puml');
  $('#inspectorBody').hidden = state.rightTab !== 'inspector';
  $('#pumlBody').hidden = state.rightTab !== 'puml';

  const selectedEl = state.selected ? m.elements.find((e) => e.id === state.selected) : undefined;
  // Searching and filtering only make sense against the list, so the bar goes with it.
  $('#filterBar').hidden = state.rightTab !== 'inspector' || !!selectedEl;
  $('#elementList').hidden = !!selectedEl;
  $('#elementDetail').hidden = !selectedEl;
  if (selectedEl) $('#elementDetail').replaceChildren(renderDetail(selectedEl, m, !!f?.editable));
  else drawList();
  $('#puml').textContent = f ? print(m) : '';
  $('#source').textContent = state.source;

  const pending = m.elements.filter((e) => e.status !== 'approved').length;
  $('#statElements').textContent = `${m.elements.length} element(s), ${m.links.length} link(s)`;
  $('#statPending').textContent = pending ? `${pending} awaiting a decision` : 'nothing pending';
  $('#statFile').textContent = f ? `${f.name}${f.editable ? '' : ' (read-only)'}` : 'no file open';

  const approve = $('#btnApprove') as HTMLButtonElement;
  approve.disabled = !f?.editable;
  approve.title = state.target
    ? `Approves everything still pending and writes it to architecture/${state.target}. Click the path in the sidebar to write somewhere else.`
    : 'Open the proposals file to approve.';

  // Layout is still per-browser, so say so rather than implying the team shares it.
  $('#layoutFoot').textContent = 'Layout saved in this browser only';
}

function onSelect(id: string) { selectElement(id); }

function doRename(id: string) {
  const f = active();
  if (!f?.editable) return;
  const e = f.model.elements.find((x) => x.id === id);
  if (!e) return;
  const name = window.prompt(`Rename "${e.name}" (id ${e.id} stays the same)`, e.name);
  if (name && name.trim() && name.trim() !== e.name) {
    setModel(rename(f.model, id, name));
    toast(`renamed, id ${e.id} kept`);
  }
}

// ---------------------------------------------------------------- drag

function onDragStart(id: string, ev: PointerEvent) {
  const f = active();
  if (!f?.editable) return;
  ev.preventDefault();
  const start = f.layout[id];
  if (!start) return;
  const g = ev.currentTarget as SVGGElement;
  g.classList.add('dragging');
  const pt0 = clientToSvg(ev.clientX, ev.clientY);
  const origin = { ...start };
  const move = (e: PointerEvent) => {
    const pt = clientToSvg(e.clientX, e.clientY);
    f.layout[id] = {
      x: Math.round((origin.x + pt.x - pt0.x) / 8) * 8,
      y: Math.round((origin.y + pt.y - pt0.y) / 8) * 8,
    };
    render(svg, f.model, f.layout, state.selected,
      { onSelect, onRename: doRename, onDragStart, onNoteDragStart }, state.routeStyle);
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    f.layoutDirty = true; // only now is there a position worth remembering
    persistLayout(f);
    draw();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

/**
 * Notes move independently of the element they annotate: the leader line re-aims at
 * wherever the note is put, so a note can be pushed out of the way of a link without
 * detaching from its subject. Stored under a note: key in the same Layout as elements.
 */
function onNoteDragStart(key: string, ev: PointerEvent) {
  const f = active();
  if (!f?.editable) return;
  ev.preventDefault();
  ev.stopPropagation();
  const g = ev.currentTarget as SVGGElement;
  const rect = g.querySelector('rect');
  const startX = f.layout[key]?.x ?? Number(rect?.getAttribute('x') ?? 0);
  const startY = f.layout[key]?.y ?? Number(rect?.getAttribute('y') ?? 0);
  const pt0 = clientToSvg(ev.clientX, ev.clientY);

  const move = (e: PointerEvent) => {
    const pt = clientToSvg(e.clientX, e.clientY);
    f.layout[key] = {
      x: Math.round((startX + pt.x - pt0.x) / 8) * 8,
      y: Math.round((startY + pt.y - pt0.y) / 8) * 8,
    };
    render(svg, f.model, f.layout, state.selected,
      { onSelect, onRename: doRename, onDragStart, onNoteDragStart }, state.routeStyle);
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    f.layoutDirty = true;
    persistLayout(f);
    draw();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function clientToSvg(cx: number, cy: number) {
  const pt = svg.createSVGPoint();
  pt.x = cx; pt.y = cy;
  const ctm = svg.getScreenCTM();
  return ctm ? pt.matrixTransform(ctm.inverse()) : { x: cx, y: cy };
}

// ---------------------------------------------------------------- file system access

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
    const file = await (entry as FileSystemFileHandle).getFile();
    const m = parse(await file.text());
    merged.elements.push(...m.elements);
    merged.links.push(...m.links);
    merged.notes.push(...m.notes);
  }
  return merged;
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
  render(svgApproved, approved, arrangeAll(approved), null, noHandlers, state.routeStyle);
}

async function writeFile(dir: FileSystemDirectoryHandle, name: string, content: string) {
  const fh = await dir.getFileHandle(name, { create: true });
  const ws = await (fh as unknown as { createWritable(): Promise<{ write(s: string): Promise<void>; close(): Promise<void> }> }).createWritable();
  await ws.write(content);
  await ws.close();
}

function download(name: string, content: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: 'text/plain' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------------------------------------------------------------- live proposals

const pendingCount = (m: Model) => m.elements.filter((e) => e.status !== 'approved').length;

async function reloadProject(announce = true) {
  const { files, source, drift } = await loadProject();
  state.files = files;
  state.source = source;
  state.drift = drift;
  // The write target follows the proposals file being reviewed.
  const proposals = files.find((f) => f.kind === 'proposals');
  state.target = proposals ? pickTarget(files, proposals) : null;
  state.openTabs = state.openTabs.filter((n) => files.some((f) => f.name === n));
  if (!state.activeName || !files.some((f) => f.name === state.activeName)) {
    const first = files.find((f) => f.kind === 'proposals') ?? files[0];
    state.activeName = first?.name ?? null;
    if (first && !state.openTabs.includes(first.name)) state.openTabs.push(first.name);
  }
  state.selected = null;
  $('#proposalBanner').hidden = true;
  draw();
  if (announce) toast(`loaded from ${source}`);
}

/**
 * Listens for Kiro finishing. The server watches the proposals file and pushes an event; a
 * browser page cannot watch the filesystem itself. If the reviewer has nothing in flight the
 * proposal loads straight away; if they are part-way through deciding, it waits behind a
 * banner rather than yanking the diagram out from under them mid-review.
 */
function listenForProposals() {
  if (typeof EventSource === 'undefined') return; // static hosting: nothing to listen to
  let es: EventSource;
  try { es = new EventSource('/api/events'); } catch { return; }

  es.onmessage = (ev) => {
    let data: { type?: string; file?: string };
    try { data = JSON.parse(ev.data); } catch { return; }
    if (data.type !== 'proposals-changed') return;

    const m = activeModel();
    if (pendingCount(m) === 0 || m.elements.length === 0) { void reloadProject(); return; }

    $('#proposalText').innerHTML =
      `Kiro proposed a change in <b>${data.file ?? 'the proposals file'}</b>. You have ${pendingCount(m)} element(s) still under review.`;
    $('#proposalBanner').hidden = false;
  };
  es.onerror = () => { /* EventSource retries on its own; not worth bothering the reviewer */ };
}

// ---------------------------------------------------------------- wiring

$('#btnLoadProposal').addEventListener('click', () => void reloadProject());
$('#btnDismissBanner').addEventListener('click', () => { $('#proposalBanner').hidden = true; });
$('#btnReset').addEventListener('click', () => void reloadProject());

$('#tabInspector').addEventListener('click', () => { state.rightTab = 'inspector'; draw(); });
$('#tabPuml').addEventListener('click', () => { state.rightTab = 'puml'; draw(); });

$('#filterText').addEventListener('input', (ev) => {
  state.filterText = (ev.target as HTMLInputElement).value;
  drawList();
});
for (const pill of document.querySelectorAll<HTMLButtonElement>('#filterPills .pill')) {
  pill.addEventListener('click', () => {
    state.filterStatus = pill.dataset['status'] as StatusFilter;
    drawList();
  });
}

$('#crumbPath').addEventListener('click', editTarget);

for (const btn of document.querySelectorAll<HTMLButtonElement>('#groupMode button')) {
  btn.addEventListener('click', () => {
    state.groupMode = btn.dataset['mode'] === 'folder' ? 'folder' : 'feature';
    drawTree();
  });
}

$('#btnRoute').addEventListener('click', () => {
  state.routeStyle = state.routeStyle === 'free' ? 'elbow' : 'free';
  $('#btnRoute').textContent = `Links: ${state.routeStyle}`;
  $('#btnRoute').classList.toggle('on', state.routeStyle === 'elbow');
  draw();
  if (state.compareOn) void refreshCompare();
});

$('#btnArrange').addEventListener('click', () => {
  const f = active();
  if (!f) return;
  // Arrange re-derives everything from the .puml, including dropping any note a reviewer
  // dragged -- leaving notes pinned beside boxes that have just moved looks broken.
  f.layout = arrangeAll(f.model);
  f.layoutDirty = true; // an explicit arrange is a choice worth keeping
  persistLayout(f);
  draw();
});

$('#btnCompare').addEventListener('click', async () => {
  state.compareOn = !state.compareOn;
  $('#btnCompare').classList.toggle('on', state.compareOn);
  $('#paneApproved').hidden = !state.compareOn;
  if (state.compareOn) await refreshCompare();
});

/** Asks the project server to write the file. False means there is no server (the page is
 *  statically hosted) or it refused, and the caller should fall back to the browser's own
 *  file access. The server validates the path again before writing. */
async function writeViaServer(target: string, text: string): Promise<boolean> {
  try {
    const res = await fetch('/api/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, text }),
    });
    if (!res.headers.get('content-type')?.includes('application/json')) return false;
    const data = await res.json() as { ok?: boolean; error?: string };
    if (!data.ok && data.error) console.warn(`approve: ${data.error}`);
    return data.ok === true;
  } catch {
    return false;
  }
}

/** Walks to a folder under the project, creating each level that is missing. The caller
 *  has already run the path through normaliseTarget, so no segment can be `..`. */
async function dirFor(root: FileSystemDirectoryHandle, segments: string[]): Promise<FileSystemDirectoryHandle> {
  let dir = root;
  for (const s of segments) dir = await dir.getDirectoryHandle(s, { create: true });
  return dir;
}

$('#btnApprove').addEventListener('click', async () => {
  const f = active();
  if (!f?.editable) { toast('open the proposals file to approve'); return; }
  if (!f.model.elements.length) { toast('nothing to approve — the diagram is empty'); return; }

  // One button: edit the diagram into the shape you want, then this accepts everything
  // still pending and writes it. setModel mutates the SAME OpenFile object `f` points at,
  // so f.model already reflects acceptAll by the time approvedOnly reads it below.
  setModel(acceptAll(f.model));
  const approved = approvedOnly(f.model);

  const text = print(approved);
  const target = state.target ?? defaultTarget(f.model.title);
  const segments = target.split('/');
  const fileName = segments[segments.length - 1]!;

  // No layout file is written by any of the routes below. Positions are derived from the
  // .puml by arrangeAll, and only a hand-moved diagram has anything worth keeping -- that
  // stays in this browser rather than cluttering architecture/, which Kiro reads wholesale
  // as approved design.

  // The project server already holds the project root, so when it is there it writes
  // straight into the hierarchy -- no folder picker, no permission prompt, any browser.
  if (await writeViaServer(target, text)) {
    toast(`wrote architecture/${target}`);
    await reloadProject(false); // the new file joins the tree where it was written
    if (state.compareOn) await refreshCompare();
    return;
  }

  const root = await getProjectDir();
  if (root) {
    try {
      // 'architecture' plus whatever feature folders the target names, created as needed:
      // approving into a folder that does not exist yet is how a feature gets started.
      const dir = await dirFor(root, ['architecture', ...segments.slice(0, -1)]);
      await writeFile(dir, fileName, text);
      toast(`wrote architecture/${target}`);
      await reloadProject(false);
      if (state.compareOn) await refreshCompare();
      return;
    } catch (err) { console.warn(err); }
  }
  await navigator.clipboard?.writeText(text).catch(() => undefined);
  download(fileName, text);
  toast(`downloaded — put it in architecture/${target}`);
});

async function init() {
  draw(); // paint the shell immediately so the page is never blank while the fetch resolves
  await reloadProject(false);
  listenForProposals();
}

void init();
