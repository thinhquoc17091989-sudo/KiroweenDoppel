/**
 * Positions for a Model. PlantUML has no coordinates, so they live in a sidecar
 * (architecture/layout.json), keyed by element id.
 *
 * Merge rule (design.md): an id that already has a position keeps it. Only ids
 * without one are placed, by a simple layered layout over the links. Nothing is
 * ever re-arranged behind the reviewer's back unless they press Arrange.
 */
import type { Model } from './model';

export interface Pos { x: number; y: number }
export type Layout = Record<string, Pos>;

export const NODE_W = 170;
export const NODE_H = 56;
const GAP_X = 110;
const GAP_Y = 36;
const MARGIN = 48;

export function nodeWidth(name: string): number {
  return Math.max(NODE_W, 24 + name.length * 8.2);
}

export const NOTE_GAP = 28;
export function noteWidth(lines: string[]): number {
  return Math.max(120, ...lines.map((s) => s.length * 6.2 + 16));
}

/** Extra horizontal room an element needs for a note drawn to its right. */
function rightNoteWidth(m: Model, id: string): number {
  const n = m.notes.find((x) => x.target === id && x.side === 'right');
  return n ? NOTE_GAP + noteWidth(n.lines) : 0;
}

/** Longest-path layering: an element sits one column right of everything that links into it. */
function layers(m: Model): Map<string, number> {
  const depth = new Map<string, number>();
  const incoming = new Map<string, string[]>();
  for (const e of m.elements) incoming.set(e.id, []);
  for (const l of m.links) if (l.from !== l.to) incoming.get(l.to)?.push(l.from);

  const visiting = new Set<string>();
  const dfs = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0; // cycle guard
    visiting.add(id);
    let d = 0;
    for (const p of incoming.get(id) ?? []) d = Math.max(d, dfs(p) + 1);
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };
  for (const e of m.elements) dfs(e.id);
  return depth;
}

/** Fresh positions for every element, ignoring the current layout. */
export function arrangeAll(m: Model): Layout {
  const depth = layers(m);
  const columns = new Map<number, string[]>();
  for (const e of m.elements) {
    const d = depth.get(e.id) ?? 0;
    if (!columns.has(d)) columns.set(d, []);
    columns.get(d)!.push(e.id);
  }
  const out: Layout = {};
  const maxRows = Math.max(1, ...[...columns.values()].map((c) => c.length));
  const totalH = maxRows * (NODE_H + GAP_Y) - GAP_Y;
  const nameOf = (id: string) => m.elements.find((e) => e.id === id)?.name ?? '';
  let x = MARGIN;
  for (const [, ids] of [...columns.entries()].sort((a, b) => a[0] - b[0])) {
    const colH = ids.length * (NODE_H + GAP_Y) - GAP_Y;
    const y0 = MARGIN + (totalH - colH) / 2;
    ids.forEach((id, i) => { out[id] = { x, y: y0 + i * (NODE_H + GAP_Y) }; });
    // the column is as wide as its widest element plus any note drawn to the right of one
    const colW = Math.max(...ids.map((id) => nodeWidth(nameOf(id)) + rightNoteWidth(m, id)));
    x += colW + GAP_X;
  }
  return out;
}

/** Keep known positions; place only newcomers, beside their nearest linked element or at the bottom. */
export function mergeLayout(m: Model, current: Layout): Layout {
  const out: Layout = {};
  for (const e of m.elements) if (current[e.id]) out[e.id] = current[e.id]!;
  const missing = m.elements.filter((e) => !out[e.id]);
  if (!missing.length) return out;
  if (!Object.keys(out).length) return arrangeAll(m);

  const placed = Object.values(out);
  let bottom = Math.max(...placed.map((p) => p.y)) + NODE_H + GAP_Y;
  for (const e of missing) {
    const neighbour = m.links
      .filter((l) => l.from === e.id || l.to === e.id)
      .map((l) => (l.from === e.id ? l.to : l.from))
      .find((id) => out[id]);
    if (neighbour) {
      const n = out[neighbour]!;
      let y = n.y;
      const x = n.x + NODE_W + GAP_X;
      while (Object.values(out).some((p) => Math.abs(p.x - x) < NODE_W && Math.abs(p.y - y) < NODE_H)) y += NODE_H + GAP_Y;
      out[e.id] = { x, y };
    } else {
      out[e.id] = { x: MARGIN, y: bottom };
      bottom += NODE_H + GAP_Y;
    }
  }
  return out;
}
