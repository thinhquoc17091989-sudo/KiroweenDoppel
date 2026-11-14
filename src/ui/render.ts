/** Draws a Model into an SVG element using positions from a Layout. */
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

export function render(
  svg: SVGSVGElement,
  m: Model,
  layout: Layout,
  selected: string | null,
  h: RenderHandlers,
  style: RouteStyle = 'free',
): void {
  svg.replaceChildren();
  const defs = el('defs');
  for (const [id, color] of [['arrow', '#4a4f5c'], ['arrow-proposed', '#7a4bd6'], ['arrow-approved', '#1f6f4a']] as const) {
    const mk = el('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, orient: 'auto-start-reverse' });
    mk.append(el('path', { d: 'M0,0 L10,5 L0,10 z', fill: color }));
    defs.append(mk);
  }
  svg.append(defs);

  const gLinks = el('g'), gNotes = el('g'), gNodes = el('g');
  svg.append(gLinks, gNotes, gNodes);

  // links
  const boxById = new Map<string, Rect>();
  for (const e of m.elements) {
    const b = boxOf(m, layout, e.id);
    if (b) boxById.set(e.id, b);
  }

  for (const l of m.links) {
    const a = boxById.get(l.from), b = boxById.get(l.to);
    if (!a || !b) continue;
    const cls = l.proposed ? 'proposed' : 'approved';

    if (l.from === l.to) {
      const d = `M${a.x + a.w - 20},${a.y} C${a.x + a.w + 30},${a.y - 40} ${a.x + a.w + 50},${a.y + 20} ${a.x + a.w},${a.y + a.h / 2}`;
      gLinks.append(el('path', { d, class: `link ${cls}`, 'marker-end': `url(#arrow-${cls})` }));
      continue;
    }

    // Everything except the two ends is something this line must not cut through.
    const obstacles = [...boxById.entries()].filter(([id]) => id !== l.from && id !== l.to).map(([, r]) => r);

    let points;
    let d: string;
    if (style === 'elbow') {
      points = elbowRoute(a, b, obstacles);
      d = toPath(points);
    } else {
      const r = freeRoute(a, b, obstacles);
      points = r.points;
      d = r.points.length === 2 && r.curved ? toCurve(r.points[0]!, r.points[1]!) : toPath(r.points);
    }
    gLinks.append(el('path', { d, class: `link ${cls}`, 'marker-end': `url(#arrow-${cls})` }));

    if (l.label) {
      // Sit the label on the middle of the route, not the straight line between the ends --
      // on an elbow those are not the same place, and the label would float off the line.
      const mid = points[Math.floor(points.length / 2)]!;
      const prev = points[Math.max(0, Math.floor(points.length / 2) - 1)]!;
      gLinks.append(el('text', {
        x: (mid.x + prev.x) / 2, y: (mid.y + prev.y) / 2 - 6,
        class: 'linklabel', 'text-anchor': 'middle',
      }, l.label));
    }
  }

  // notes
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

    const g = el('g', { class: 'note', 'data-note': key });
    // The leader line always re-aims at wherever the note ended up, so a dragged note stays
    // visibly attached to what it annotates.
    const from = anchor(b, { x: x + w / 2, y: y + hh / 2 });
    const toward = anchor({ x, y, w, h: hh }, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
    g.append(el('line', { x1: from.x, y1: from.y, x2: toward.x, y2: toward.y }));
    g.append(el('rect', { x, y, width: w, height: hh, rx: 3 }));
    n.lines.forEach((line, j) => g.append(el('text', { x: x + 8, y: y + 17 + j * 14 }, line)));
    if (h.onNoteDragStart) {
      g.classList.add('draggable');
      g.addEventListener('pointerdown', (ev) => h.onNoteDragStart!(key, ev));
    }
    gNotes.append(g);
  });

  // nodes
  for (const e of m.elements) {
    const b = boxOf(m, layout, e.id);
    if (!b) continue;
    const g = el('g', { class: `node ${e.status} ${e.kind}${selected === e.id ? ' hl' : ''}`, 'data-id': e.id, transform: `translate(${b.x},${b.y})` });
    g.append(el('rect', { class: 'body', width: b.w, height: b.h, rx: 6 }));
    const kindLabel = e.kind === 'interface' ? '«interface»'
      : e.status === 'proposed' ? '«proposed»'
      : e.status === 'modified' ? '«modified»'
      : '«component»';
    g.append(el('text', { class: 'kind', x: 10, y: 15 }, kindLabel));
    g.append(el('text', { class: 'label', x: b.w / 2, y: 36, 'text-anchor': 'middle' }, e.name));
    if (e.req.length) g.append(el('text', { class: 'req', x: b.w - 10, y: 15, 'text-anchor': 'end' }, e.req.join(' ')));
    if (e.desc) {
      // A tiny dot, not a redrawn box: showing the description costs zero diagram space
      // until someone actually hovers it, rather than permanently growing every node that
      // has one. The native <title> gives a real tooltip for free, no JS positioning code.
      const dot = el('circle', { class: 'descDot', cx: b.w - 10, cy: b.h - 10, r: 3 });
      dot.append(el('title', {}, e.desc));
      g.append(dot);
    }
    g.addEventListener('pointerdown', (ev) => { h.onSelect(e.id); h.onDragStart(e.id, ev); });
    g.addEventListener('dblclick', () => h.onRename(e.id));
    gNodes.append(g);
  }

  // viewBox fits content
  const boxes = m.elements.map((e) => boxOf(m, layout, e.id)).filter((x): x is Box => !!x);
  if (boxes.length) {
    const minX = Math.min(...boxes.map((b) => b.x)) - 60, minY = Math.min(...boxes.map((b) => b.y)) - 60;
    const maxX = Math.max(...boxes.map((b) => b.x + b.w)) + 260, maxY = Math.max(...boxes.map((b) => b.y + b.h)) + 60;
    svg.setAttribute('viewBox', `${minX} ${minY} ${Math.max(600, maxX - minX)} ${Math.max(400, maxY - minY)}`);
  }
}
