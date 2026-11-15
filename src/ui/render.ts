/**
 * Draws a Model into an SVG element using positions from a Layout.
 *
 * The drawing is reconciled, not rebuilt. An earlier version cleared the SVG and recreated
 * every node on each call, which meant the browser re-shaped the fonts for every label on
 * every selection, drag frame and file switch — the diagram's text is by far the most
 * expensive thing on the canvas to lay out. Here each element keeps its DOM node between
 * renders and only the attributes that actually differ are written, so an unchanged label
 * costs nothing at all.
 *
 * Two consequences worth knowing when editing this file:
 *  - Listeners are attached once, when a node is created, and read the current handlers
 *    through `st.h`. Re-attaching them per render would undo the point of reusing nodes.
 *  - Paint order follows the model, but the re-append pass that enforces it only runs when
 *    the set of keys has actually changed.
 */
import type { Model } from '../core/model.ts';
import { NODE_H, NOTE_GAP, noteWidth, nodeWidth, type Layout, type Pos } from '../core/layout.ts';
import { elbowRoute, freeRoute, toCurve, toPath, type Rect, type RouteStyle } from '../core/route.ts';

/** Stable key for a note's position in the Layout, so a dragged note stays where it was put.
 *  Notes carry no id of their own, so they are keyed by what they annotate plus their order. */
export const noteKey = (target: string, index: number) => `note:${target}:${index}`;

const NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, text?: string): SVGElementTagNameMap[K] {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text !== undefined) n.textContent = text;
  return n;
}

/** Writes only when the value differs: an unchanged attribute costs no invalidation. */
function attr(node: Element, name: string, value: string | number): void {
  const v = String(value);
  if (node.getAttribute(name) !== v) node.setAttribute(name, v);
}

/** The expensive one. Setting textContent re-shapes the text even to the same string. */
function setText(node: Element, value: string): void {
  if (node.textContent !== value) node.textContent = value;
}

interface Box { x: number; y: number; w: number; h: number }

function boxOf(m: Model, layout: Layout, id: string): Box | undefined {
  const e = m.elements.find((x) => x.id === id);
  const p = layout[id];
  if (!e || !p) return undefined;
  return { x: p.x, y: p.y, w: nodeWidth(e.name), h: NODE_H };
}

/** Point on the box border facing a target point. */
function anchor(b: Box, toward: Pos): Pos {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  const dx = toward.x - cx, dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const sx = (b.w / 2) / Math.abs(dx || 1e-9), sy = (b.h / 2) / Math.abs(dy || 1e-9);
  const s = Math.min(sx, sy);
  return { x: cx + dx * s, y: cy + dy * s };
}

export interface RenderHandlers {
  onSelect(id: string): void;
  onRename(id: string): void;
  onDragStart(id: string, ev: PointerEvent): void;
  /** Dragging a note moves only that note, never the element it points at. */
  onNoteDragStart?(key: string, ev: PointerEvent): void;
}

interface NodeParts {
  g: SVGGElement;
  rect: SVGRectElement;
  kind: SVGTextElement;
  label: SVGTextElement;
  req?: SVGTextElement;
  dot?: SVGCircleElement;
  title?: SVGTitleElement;
}
interface LinkParts { path: SVGPathElement; label?: SVGTextElement }
interface NoteParts { g: SVGGElement; line: SVGLineElement; rect: SVGRectElement; texts: SVGTextElement[] }

interface RenderState {
  gLinks: SVGGElement;
  gNotes: SVGGElement;
  gNodes: SVGGElement;
  nodes: Map<string, NodeParts>;
  links: Map<string, LinkParts>;
  notes: Map<string, NoteParts>;
  /** The latest handlers, read by listeners that were attached once at creation. */
  h: RenderHandlers;
  nodeOrder: string;
  linkOrder: string;
  noteOrder: string;
}

const states = new WeakMap<SVGSVGElement, RenderState>();

function init(svg: SVGSVGElement, h: RenderHandlers): RenderState {
  svg.replaceChildren();
  const defs = el('defs');
  for (const [id, color] of [['arrow', '#4a4f5c'], ['arrow-proposed', '#7a4bd6'], ['arrow-approved', '#1f6f4a']] as const) {
    const mk = el('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, orient: 'auto-start-reverse' });
    mk.append(el('path', { d: 'M0,0 L10,5 L0,10 z', fill: color }));
    defs.append(mk);
  }
  const gLinks = el('g'), gNotes = el('g'), gNodes = el('g');
  svg.append(defs, gLinks, gNotes, gNodes);

  const st: RenderState = {
    gLinks, gNotes, gNodes,
    nodes: new Map(), links: new Map(), notes: new Map(),
    h, nodeOrder: '', linkOrder: '', noteOrder: '',
  };
  states.set(svg, st);
  return st;
}

/**
 * Drops whatever is no longer in the model, then puts the survivors back in model order —
 * but only when that order actually changed, since re-appending is itself a DOM mutation.
 *
 * `nodesOf` returns every node a key owns, in paint order. A link owns two (its path and,
 * when it has one, its label), and both have to move together: re-appending only the paths
 * would leave every label stranded in front of them.
 */
function reconcile<T>(
  group: SVGGElement,
  map: Map<string, T>,
  seen: string[],
  orderKey: 'nodeOrder' | 'linkOrder' | 'noteOrder',
  st: RenderState,
  nodesOf: (v: T) => (Element | undefined)[],
): void {
  const keep = new Set(seen);
  for (const [k, v] of map) {
    if (keep.has(k)) continue;
    for (const n of nodesOf(v)) n?.remove();
    map.delete(k);
  }
  // The signature covers which optional nodes exist, so a label appearing or disappearing
  // re-runs the ordering pass rather than silently leaving the newcomer at the end.
  const order = seen.map((k) => `${k}:${nodesOf(map.get(k)!).map((n) => (n ? 1 : 0)).join('')}`).join(',');
  if (order === st[orderKey]) return;
  st[orderKey] = order;
  for (const k of seen) {
    for (const n of nodesOf(map.get(k)!)) if (n) group.append(n);
  }
}

export function render(
  svg: SVGSVGElement,
  m: Model,
  layout: Layout,
  selected: string | null,
  h: RenderHandlers,
  style: RouteStyle = 'free',
): void {
  const st = states.get(svg) ?? init(svg, h);
  st.h = h; // listeners attached at creation always call through to the current handlers

  // ---------------------------------------------------------------- links
  const boxById = new Map<string, Rect>();
  for (const e of m.elements) {
    const b = boxOf(m, layout, e.id);
    if (b) boxById.set(e.id, b);
  }

  const linkKeys: string[] = [];
  m.links.forEach((l, i) => {
    const a = boxById.get(l.from), b = boxById.get(l.to);
    if (!a || !b) return;
    const key = String(i);
    linkKeys.push(key);
    const cls = l.proposed ? 'proposed' : 'approved';

    let parts = st.links.get(key);
    if (!parts) {
      parts = { path: el('path') };
      st.gLinks.append(parts.path);
      st.links.set(key, parts);
    }

    let d: string;
    let labelAt: Pos | null = null;
    if (l.from === l.to) {
      d = `M${a.x + a.w - 20},${a.y} C${a.x + a.w + 30},${a.y - 40} ${a.x + a.w + 50},${a.y + 20} ${a.x + a.w},${a.y + a.h / 2}`;
    } else {
      // Everything except the two ends is something this line must not cut through.
      const obstacles = [...boxById.entries()].filter(([id]) => id !== l.from && id !== l.to).map(([, r]) => r);
      let points;
      if (style === 'elbow') {
        points = elbowRoute(a, b, obstacles);
        d = toPath(points);
      } else {
        const r = freeRoute(a, b, obstacles);
        points = r.points;
        d = r.points.length === 2 && r.curved ? toCurve(r.points[0]!, r.points[1]!) : toPath(r.points);
      }
      // Sit the label on the middle of the route, not the straight line between the ends --
      // on an elbow those are not the same place, and the label would float off the line.
      const mid = points[Math.floor(points.length / 2)]!;
      const prev = points[Math.max(0, Math.floor(points.length / 2) - 1)]!;
      labelAt = { x: (mid.x + prev.x) / 2, y: (mid.y + prev.y) / 2 - 6 };
    }

    attr(parts.path, 'd', d);
    attr(parts.path, 'class', `link ${cls}`);
    attr(parts.path, 'marker-end', `url(#arrow-${cls})`);

    if (l.label && labelAt) {
      if (!parts.label) {
        parts.label = el('text', { class: 'linklabel', 'text-anchor': 'middle' });
        st.gLinks.append(parts.label);
      }
      attr(parts.label, 'x', labelAt.x);
      attr(parts.label, 'y', labelAt.y);
      setText(parts.label, l.label);
    } else if (parts.label) {
      parts.label.remove();
      delete parts.label;
    }
  });
  reconcile(st.gLinks, st.links, linkKeys, 'linkOrder', st, (v) => [v.path, v.label]);

  // ---------------------------------------------------------------- notes
  const noteKeys: string[] = [];
  m.notes.forEach((n, i) => {
    const b = boxOf(m, layout, n.target);
    if (!b) return;
    const w = noteWidth(n.lines), hh = 14 * n.lines.length + 12;

    // Default position comes from the side the .puml declared; a dragged note overrides it.
    let x = b.x + b.w + NOTE_GAP, y = b.y + (b.h - hh) / 2;
    if (n.side === 'left') x = b.x - w - NOTE_GAP;
    if (n.side === 'top') { x = b.x + (b.w - w) / 2; y = b.y - hh - 24; }
    if (n.side === 'bottom') { x = b.x + (b.w - w) / 2; y = b.y + b.h + 24; }
    const key = noteKey(n.target, i);
    const moved = layout[key];
    if (moved) { x = moved.x; y = moved.y; }
    noteKeys.push(key);

    let parts = st.notes.get(key);
    if (!parts) {
      const g = el('g', { class: 'note' });
      const line = el('line');
      const rect = el('rect', { rx: 3 });
      g.append(line, rect);
      g.addEventListener('pointerdown', (ev) => st.h.onNoteDragStart?.(key, ev));
      st.gNotes.append(g);
      parts = { g, line, rect, texts: [] };
      st.notes.set(key, parts);
    }
    attr(parts.g, 'data-note', key);
    parts.g.classList.toggle('draggable', !!h.onNoteDragStart);

    // The leader line always re-aims at wherever the note ended up, so a dragged note stays
    // visibly attached to what it annotates.
    const from = anchor(b, { x: x + w / 2, y: y + hh / 2 });
    const toward = anchor({ x, y, w, h: hh }, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
    attr(parts.line, 'x1', from.x); attr(parts.line, 'y1', from.y);
    attr(parts.line, 'x2', toward.x); attr(parts.line, 'y2', toward.y);
    attr(parts.rect, 'x', x); attr(parts.rect, 'y', y);
    attr(parts.rect, 'width', w); attr(parts.rect, 'height', hh);

    while (parts.texts.length > n.lines.length) parts.texts.pop()!.remove();
    n.lines.forEach((line, j) => {
      let t = parts!.texts[j];
      if (!t) { t = el('text'); parts!.g.append(t); parts!.texts[j] = t; }
      attr(t, 'x', x + 8);
      attr(t, 'y', y + 17 + j * 14);
      setText(t, line);
    });
  });
  reconcile(st.gNotes, st.notes, noteKeys, 'noteOrder', st, (v) => [v.g]);

  // ---------------------------------------------------------------- nodes
  const nodeKeys: string[] = [];
  for (const e of m.elements) {
    const b = boxOf(m, layout, e.id);
    if (!b) continue;
    nodeKeys.push(e.id);

    let parts = st.nodes.get(e.id);
    if (!parts) {
      const g = el('g', { 'data-id': e.id });
      const rect = el('rect', { class: 'body', rx: 6 });
      const kind = el('text', { class: 'kind', x: 10, y: 15 });
      const label = el('text', { class: 'label', y: 36, 'text-anchor': 'middle' });
      g.append(rect, kind, label);
      g.addEventListener('pointerdown', (ev) => { st.h.onSelect(e.id); st.h.onDragStart(e.id, ev); });
      g.addEventListener('dblclick', () => st.h.onRename(e.id));
      st.gNodes.append(g);
      parts = { g, rect, kind, label };
      st.nodes.set(e.id, parts);
    }

    attr(parts.g, 'class', `node ${e.status} ${e.kind}${selected === e.id ? ' hl' : ''}`);
    attr(parts.g, 'transform', `translate(${b.x},${b.y})`);
    attr(parts.rect, 'width', b.w);
    attr(parts.rect, 'height', b.h);

    const kindLabel = e.kind === 'interface' ? '«interface»'
      : e.status === 'proposed' ? '«proposed»'
      : e.status === 'modified' ? '«modified»'
      : '«component»';
    setText(parts.kind, kindLabel);
    attr(parts.label, 'x', b.w / 2);
    setText(parts.label, e.name);

    if (e.req.length) {
      if (!parts.req) { parts.req = el('text', { class: 'req', y: 15, 'text-anchor': 'end' }); parts.g.append(parts.req); }
      attr(parts.req, 'x', b.w - 10);
      setText(parts.req, e.req.join(' '));
    } else if (parts.req) {
      parts.req.remove();
      delete parts.req;
    }

    if (e.desc) {
      // A tiny dot, not a redrawn box: showing the description costs zero diagram space
      // until someone actually hovers it, rather than permanently growing every node that
      // has one. The native <title> gives a real tooltip for free, no JS positioning code.
      if (!parts.dot) {
        parts.dot = el('circle', { class: 'descDot', r: 3 });
        parts.title = el('title');
        parts.dot.append(parts.title);
        parts.g.append(parts.dot);
      }
      attr(parts.dot, 'cx', b.w - 10);
      attr(parts.dot, 'cy', b.h - 10);
      setText(parts.title!, e.desc);
    } else if (parts.dot) {
      parts.dot.remove();
      delete parts.dot;
      delete parts.title;
    }
  }
  reconcile(st.gNodes, st.nodes, nodeKeys, 'nodeOrder', st, (v) => [v.g]);

  // ---------------------------------------------------------------- viewBox
  const boxes = m.elements.map((e) => boxOf(m, layout, e.id)).filter((x): x is Box => !!x);
  if (boxes.length) {
    const minX = Math.min(...boxes.map((b) => b.x)) - 60, minY = Math.min(...boxes.map((b) => b.y)) - 60;
    const maxX = Math.max(...boxes.map((b) => b.x + b.w)) + 260, maxY = Math.max(...boxes.map((b) => b.y + b.h)) + 60;
    attr(svg, 'viewBox', `${minX} ${minY} ${Math.max(600, maxX - minX)} ${Math.max(400, maxY - minY)}`);
  }
}
