/**
 * Positions for a Model. PlantUML has no coordinates, so they live in a sidecar
 * (architecture/layout.json), keyed by element id.
 *
 * Merge rule (design.md): an id that already has a position keeps it. Only ids
 * without one are placed, by a simple layered layout over the links. Nothing is
 * ever re-arranged behind the reviewer's back unless they press Arrange.
 */
import type { Model } from './model.ts';
import { rankByLongestPath } from './rank.ts';

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
  return rankByLongestPath(m.elements.map((e) => e.id), m.links);
}

/** Roughly how wide a link's label will be drawn, so a column gap can make room for it. */
function labelWidth(label: string): number {
  return label ? label.length * 6.6 + 12 : 0;
}

/**
 * Reorders the elements inside each column so that connected things line up and fewer
 * links cross. This is the ordering phase of the standard layered-graph method (Sugiyama):
 * sweep forward and back, and in each pass move every node to the average position of the
 * neighbours it is connected to in the adjacent column. A few sweeps settle it.
 *
 * Declaration order breaks every tie, so the same file always lays out identically — a
 * diagram that shuffled itself between openings would make the saved-position merge and
 * any visual diff worthless.
 */
function orderWithinColumns(columns: Map<number, string[]>, m: Model, declOrder: Map<string, number>): void {
  const neighbours = new Map<string, string[]>();
  for (const e of m.elements) neighbours.set(e.id, []);
  for (const l of m.links) {
    if (l.from === l.to) continue;
    neighbours.get(l.from)?.push(l.to);
    neighbours.get(l.to)?.push(l.from);
  }

  const depths = [...columns.keys()].sort((a, b) => a - b);
  const indexOf = new Map<string, number>();
  const reindex = () => {
    for (const d of depths) columns.get(d)!.forEach((id, i) => indexOf.set(id, i));
  };
  reindex();

  for (let sweep = 0; sweep < 4; sweep++) {
    const order = sweep % 2 ? [...depths].reverse() : depths;
    const towards = sweep % 2 ? 1 : -1;
    for (const d of order) {
      const adjacent = columns.get(d + towards);
      if (!adjacent) continue;
      const here = columns.get(d)!;
      const key = new Map<string, number>();
      for (const id of here) {
        const positions = (neighbours.get(id) ?? [])
          .filter((n) => adjacent.includes(n))
          .map((n) => indexOf.get(n) ?? 0);
        // No neighbour in that direction: keep where it is rather than drifting to the top.
        key.set(id, positions.length
          ? positions.reduce((a, b) => a + b, 0) / positions.length
          : (indexOf.get(id) ?? 0));
      }
      here.sort((a, b) => (key.get(a)! - key.get(b)!) || (declOrder.get(a)! - declOrder.get(b)!));
      reindex();
    }
  }
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

  const declOrder = new Map(m.elements.map((e, i) => [e.id, i] as const));
  orderWithinColumns(columns, m, declOrder);

  const out: Layout = {};
  const nameOf = (id: string) => m.elements.find((e) => e.id === id)?.name ?? '';
  const depths = [...columns.keys()].sort((a, b) => a - b);

  // --- y: start each column stacked and centred, then pull nodes towards the things they
  // connect to on the left, resolving any overlap that creates. Pulling first and
  // separating afterwards is what makes a chain of linked elements come out level.
  const maxRows = Math.max(1, ...[...columns.values()].map((c) => c.length));
  const totalH = maxRows * (NODE_H + GAP_Y) - GAP_Y;
  const y = new Map<string, number>();
  for (const d of depths) {
    const ids = columns.get(d)!;
    const colH = ids.length * (NODE_H + GAP_Y) - GAP_Y;
    const y0 = MARGIN + (totalH - colH) / 2;
    ids.forEach((id, i) => y.set(id, y0 + i * (NODE_H + GAP_Y)));
  }

  const incoming = new Map<string, string[]>();
  for (const e of m.elements) incoming.set(e.id, []);
  for (const l of m.links) if (l.from !== l.to) incoming.get(l.to)?.push(l.from);

  /** Push a column apart in order until nothing overlaps, then recentre it so the whole
   *  column does not creep downwards every pass. */
  const separate = (ids: string[]) => {
    for (let i = 1; i < ids.length; i++) {
      const prev = y.get(ids[i - 1]!)!;
      const want = prev + NODE_H + GAP_Y;
      if (y.get(ids[i]!)! < want) y.set(ids[i]!, want);
    }
    const first = y.get(ids[0]!)!;
    if (first < MARGIN) {
      const shift = MARGIN - first;
      for (const id of ids) y.set(id, y.get(id)! + shift);
    }
  };

  for (let pass = 0; pass < 2; pass++) {
    for (const d of depths.slice(1)) {
      const ids = columns.get(d)!;
      for (const id of ids) {
        const parents = (incoming.get(id) ?? []).filter((p) => y.has(p));
        if (parents.length) {
          y.set(id, parents.reduce((s, p) => s + y.get(p)!, 0) / parents.length);
        }
      }
      ids.sort((a, b) => (y.get(a)! - y.get(b)!) || (declOrder.get(a)! - declOrder.get(b)!));
      separate(ids);
    }
  }

  // --- x: a column is as wide as its widest element plus any note drawn to its right, and
  // each gap is widened for the widest link label that has to sit in it, so labels are not
  // painted over the boxes either side.
  let x = MARGIN;
  for (let i = 0; i < depths.length; i++) {
    const d = depths[i]!;
    const ids = columns.get(d)!;
    for (const id of ids) out[id] = { x: Math.round(x), y: Math.round(y.get(id)!) };

    const colW = Math.max(...ids.map((id) => nodeWidth(nameOf(id)) + rightNoteWidth(m, id)));
    const crossingLabels = m.links
      .filter((l) => (depth.get(l.from) ?? 0) === d && (depth.get(l.to) ?? 0) === d + 1)
      .map((l) => labelWidth(l.label));
    const gap = Math.max(GAP_X, crossingLabels.length ? Math.max(...crossingLabels) + 24 : 0);
    x += colW + gap;
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
