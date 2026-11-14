/**
 * Where a link's line actually goes.
 *
 * Two styles, because they are good at different things:
 *  - **free**  — a smooth curve straight from one box to the other. Reads well when the
 *                diagram is sparse, and makes it obvious at a glance which pairs are linked.
 *  - **elbow** — horizontal and vertical segments only, meeting at right angles. Harder to
 *                follow one line in isolation, but far easier to read when many links run
 *                through the same space, which is exactly when free curves turn to spaghetti.
 *
 * Both avoid drawing a line straight through a box that is not either endpoint. A line
 * crossing a component is actively misleading: it reads as touching something it does not.
 */

export interface Rect { x: number; y: number; w: number; h: number }
export interface Point { x: number; y: number }
export type RouteStyle = 'free' | 'elbow';

/** How far a line stands off a box before turning, so corners do not graze the border. */
const STANDOFF = 18;
/** Clearance kept when routing around an obstacle. */
const CLEAR = 14;

const right = (r: Rect) => r.x + r.w;
const bottom = (r: Rect) => r.y + r.h;
const centre = (r: Rect): Point => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Does a horizontal or vertical segment pass through this rect? Endpoints touching the
 *  rect's own border do not count, or every link would collide with its own endpoints. */
export function segmentHitsRect(p: Point, q: Point, r: Rect): boolean {
  const minX = Math.min(p.x, q.x), maxX = Math.max(p.x, q.x);
  const minY = Math.min(p.y, q.y), maxY = Math.max(p.y, q.y);
  // Shrink the rect a hair so a line running exactly along an edge is not counted as a hit.
  const rx1 = r.x + 0.5, rx2 = right(r) - 0.5, ry1 = r.y + 0.5, ry2 = bottom(r) - 0.5;
  return maxX > rx1 && minX < rx2 && maxY > ry1 && minY < ry2;
}

/** Any obstacle crossed by this chain of points? */
export function pathHitsAny(points: Point[], obstacles: Rect[]): boolean {
  for (let i = 1; i < points.length; i++) {
    for (const o of obstacles) {
      if (segmentHitsRect(points[i - 1]!, points[i]!, o)) return true;
    }
  }
  return false;
}

/** Which side of `from` faces `to`, used to decide where a line leaves a box. */
function exitSide(from: Rect, to: Rect): 'left' | 'right' | 'up' | 'down' {
  const a = centre(from), b = centre(to);
  if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) return b.x >= a.x ? 'right' : 'left';
  return b.y >= a.y ? 'down' : 'up';
}

function portOn(r: Rect, side: 'left' | 'right' | 'up' | 'down'): Point {
  const c = centre(r);
  switch (side) {
    case 'left': return { x: r.x, y: c.y };
    case 'right': return { x: right(r), y: c.y };
    case 'up': return { x: c.x, y: r.y };
    case 'down': return { x: c.x, y: bottom(r) };
  }
}

const opposite = { left: 'right', right: 'left', up: 'down', down: 'up' } as const;

/**
 * Orthogonal route between two boxes. The usual shape is out-across-in: leave the source,
 * run to a channel halfway between, cross, then come in to the target. If that channel is
 * blocked the route is retried through other channels — above everything, below everything,
 * or hugging either box — and the first clear one wins. If nothing is clear it returns the
 * straightforward route anyway rather than nothing at all, because a slightly ugly line
 * beats a missing one.
 */
export function elbowRoute(from: Rect, to: Rect, obstacles: Rect[]): Point[] {
  const side = exitSide(from, to);
  const horizontal = side === 'left' || side === 'right';
  const start = portOn(from, side);
  const end = portOn(to, opposite[side]);

  const out: Point = horizontal
    ? { x: start.x + (side === 'right' ? STANDOFF : -STANDOFF), y: start.y }
    : { x: start.x, y: start.y + (side === 'down' ? STANDOFF : -STANDOFF) };
  const into: Point = horizontal
    ? { x: end.x + (side === 'right' ? -STANDOFF : STANDOFF), y: end.y }
    : { x: end.x, y: end.y + (side === 'down' ? -STANDOFF : STANDOFF) };

  const build = (channel: number): Point[] => horizontal
    ? [start, out, { x: channel, y: out.y }, { x: channel, y: into.y }, into, end]
    : [start, out, { x: out.x, y: channel }, { x: into.x, y: channel }, into, end];

  // Candidate channels, best first: the midpoint, then routes that skirt the obstacles.
  const spread = obstacles.length
    ? {
        min: Math.min(...obstacles.map((o) => (horizontal ? o.x : o.y))) - CLEAR,
        max: Math.max(...obstacles.map((o) => (horizontal ? right(o) : bottom(o)))) + CLEAR,
      }
    : null;

  const candidates = [
    horizontal ? (out.x + into.x) / 2 : (out.y + into.y) / 2,
    horizontal ? out.x : out.y,
    horizontal ? into.x : into.y,
    ...(spread ? [spread.min, spread.max] : []),
  ];

  for (const channel of candidates) {
    const points = build(channel);
    if (!pathHitsAny(points, obstacles)) return points;
  }
  // Nothing clear off the shelf: take the straightforward route and shove its middle clear.
  return nudgeClearOfBoxes(build(horizontal ? (out.x + into.x) / 2 : (out.y + into.y) / 2), obstacles);
}

/**
 * Shifts a route's interior segments off any box they cut through.
 *
 * Two rules make this safe, and both are easy to get wrong:
 *  - **Only interior segments move.** The first and last segments are the stubs leaving and
 *    entering a box; moving either detaches the line from its anchor. Shifting an interior
 *    segment's shared coordinate only changes how long its neighbours are, never their
 *    direction, so the path stays orthogonal.
 *  - **Score both sides against every obstacle before choosing.** Sliding to the nearer face
 *    is the obvious move and the wrong one in a packed diagram: it pushes the line straight
 *    into the next box, the following pass pushes it back, and the route ends up wedged
 *    between two boxes instead of clear of either.
 *
 * Bounded passes, because clearing one box can expose a collision with another.
 */
export function nudgeClearOfBoxes(points: Point[], obstacles: Rect[]): Point[] {
  if (!obstacles.length || points.length < 4) return points;
  const pts = points.map((p) => ({ ...p }));

  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (let i = 1; i < pts.length - 2; i++) {
      const a = pts[i]!, b = pts[i + 1]!;
      const vertical = Math.abs(a.x - b.x) < 0.5;
      const horizontalSeg = Math.abs(a.y - b.y) < 0.5;
      if (!vertical && !horizontalSeg) continue; // diagonal: not ours to move

      const blocking = obstacles.filter((o) => segmentHitsRect(a, b, o));
      if (!blocking.length) continue;

      // Candidate coordinates: clear of every blocking box on one side or the other.
      const options = vertical
        ? blocking.flatMap((o) => [o.x - CLEAR, right(o) + CLEAR])
        : blocking.flatMap((o) => [o.y - CLEAR, bottom(o) + CLEAR]);

      const current = vertical ? a.x : a.y;
      let best: number | null = null;
      let bestCost = Infinity;
      for (const v of options) {
        const trial = vertical
          ? [{ x: v, y: a.y }, { x: v, y: b.y }]
          : [{ x: a.x, y: v }, { x: b.x, y: v }];
        const hits = obstacles.filter((o) => segmentHitsRect(trial[0]!, trial[1]!, o)).length;
        // Prefer a side that is genuinely free; among equals, move the least.
        const cost = hits * 1000 + Math.abs(v - current);
        if (cost < bestCost) { bestCost = cost; best = v; }
      }
      if (best === null) continue;

      if (vertical) { a.x = best; b.x = best; } else { a.y = best; b.y = best; }
      moved = true;
    }
    if (!moved) break;
  }
  return pts;
}

/**
 * The free route: a straight line where the boxes already line up, otherwise a curve. If
 * the direct line would cut through something, it falls back to the elbow route — a curve
 * that passes through a component is worse than a right angle that does not.
 */
export function freeRoute(from: Rect, to: Rect, obstacles: Rect[]): { points: Point[]; curved: boolean } {
  const a = centre(from), b = centre(to);
  const side = exitSide(from, to);
  const start = portOn(from, side);
  const end = portOn(to, opposite[side]);

  const level = Math.abs(start.y - end.y) < 4 || Math.abs(start.x - end.x) < 4;
  if (!pathHitsAny([start, end], obstacles)) {
    return { points: [start, end], curved: !level };
  }
  // Direct line is blocked; right angles at least stay out of the boxes.
  void a; void b;
  return { points: elbowRoute(from, to, obstacles), curved: false };
}

/** An SVG path for a chain of points: straight segments, with corners slightly rounded so
 *  an elbow does not look like a staircase of hard pixels. */
export function toPath(points: Point[], radius = 7): string {
  if (points.length < 2) return '';
  if (points.length === 2) return `M${points[0]!.x},${points[0]!.y} L${points[1]!.x},${points[1]!.y}`;

  let d = `M${points[0]!.x},${points[0]!.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!, cur = points[i]!, next = points[i + 1]!;
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r < 1) { d += ` L${cur.x},${cur.y}`; continue; }
    const t1 = { x: cur.x + ((prev.x - cur.x) / inLen) * r, y: cur.y + ((prev.y - cur.y) / inLen) * r };
    const t2 = { x: cur.x + ((next.x - cur.x) / outLen) * r, y: cur.y + ((next.y - cur.y) / outLen) * r };
    d += ` L${t1.x},${t1.y} Q${cur.x},${cur.y} ${t2.x},${t2.y}`;
  }
  const last = points[points.length - 1]!;
  return `${d} L${last.x},${last.y}`;
}

/** A smooth curve for the free style, bulging horizontally or vertically as appropriate. */
export function toCurve(p1: Point, p2: Point): string {
  if (Math.abs(p1.y - p2.y) < 4) return `M${p1.x},${p1.y} L${p2.x},${p2.y}`;
  const mx = (p1.x + p2.x) / 2;
  return `M${p1.x},${p1.y} C${mx},${p1.y} ${mx},${p2.y} ${p2.x},${p2.y}`;
}
