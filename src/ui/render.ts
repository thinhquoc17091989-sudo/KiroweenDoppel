/** Draws a Model into an SVG element using positions from a Layout. */
import type { Model } from '../core/model';
import { NODE_H, NOTE_GAP, noteWidth, nodeWidth, type Layout, type Pos } from '../core/layout';

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
}

export function render(svg: SVGSVGElement, m: Model, layout: Layout, selected: string | null, h: RenderHandlers): void {
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
  for (const l of m.links) {
    const a = boxOf(m, layout, l.from), b = boxOf(m, layout, l.to);
    if (!a || !b) continue;
    const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    const p1 = anchor(a, cb), p2 = anchor(b, ca);
    const cls = l.proposed ? 'proposed' : 'approved';
    let d: string;
    if (l.from === l.to) {
      d = `M${a.x + a.w - 20},${a.y} C${a.x + a.w + 30},${a.y - 40} ${a.x + a.w + 50},${a.y + 20} ${a.x + a.w},${a.y + a.h / 2}`;
    } else {
      const mx = (p1.x + p2.x) / 2;
      d = Math.abs(p1.y - p2.y) < 4 ? `M${p1.x},${p1.y} L${p2.x},${p2.y}` : `M${p1.x},${p1.y} C${mx},${p1.y} ${mx},${p2.y} ${p2.x},${p2.y}`;
    }
    gLinks.append(el('path', { d, class: `link ${cls}`, 'marker-end': `url(#arrow-${cls})` }));
    if (l.label) {
      const lx = (p1.x + p2.x) / 2, ly = (p1.y + p2.y) / 2 - 6;
      gLinks.append(el('text', { x: lx, y: ly, class: 'linklabel', 'text-anchor': 'middle' }, l.label));
    }
  }

  // notes
  for (const n of m.notes) {
    const b = boxOf(m, layout, n.target);
    if (!b) continue;
    const w = noteWidth(n.lines), hh = 14 * n.lines.length + 12;
    let x = b.x + b.w + NOTE_GAP, y = b.y + (b.h - hh) / 2;
    if (n.side === 'left') x = b.x - w - NOTE_GAP;
    if (n.side === 'top') { x = b.x + (b.w - w) / 2; y = b.y - hh - 24; }
    if (n.side === 'bottom') { x = b.x + (b.w - w) / 2; y = b.y + b.h + 24; }
    const g = el('g', { class: 'note' });
    const from = anchor(b, { x: x + w / 2, y: y + hh / 2 });
    g.append(el('line', { x1: from.x, y1: from.y, x2: x + (n.side === 'left' ? w : n.side === 'right' ? 0 : w / 2), y2: y + (n.side === 'top' ? hh : n.side === 'bottom' ? 0 : hh / 2) }));
    g.append(el('rect', { x, y, width: w, height: hh, rx: 3 }));
    n.lines.forEach((s, i) => g.append(el('text', { x: x + 8, y: y + 17 + i * 14 }, s)));
    gNotes.append(g);
  }

  // nodes
  for (const e of m.elements) {
    const b = boxOf(m, layout, e.id);
    if (!b) continue;
    const g = el('g', { class: `node ${e.status} ${e.kind}${selected === e.id ? ' hl' : ''}`, 'data-id': e.id, transform: `translate(${b.x},${b.y})` });
    g.append(el('rect', { class: 'body', width: b.w, height: b.h, rx: 6 }));
    g.append(el('text', { class: 'kind', x: 10, y: 15 }, e.kind === 'interface' ? '«interface»' : e.status === 'proposed' ? '«proposed»' : '«component»'));
    g.append(el('text', { class: 'label', x: b.w / 2, y: 36, 'text-anchor': 'middle' }, e.name));
    if (e.req.length) g.append(el('text', { class: 'req', x: b.w - 10, y: 15, 'text-anchor': 'end' }, e.req.join(' ')));
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
