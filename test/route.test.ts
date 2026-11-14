import { describe, expect, it } from 'vitest';
import { elbowRoute, freeRoute, nudgeClearOfBoxes, pathHitsAny, segmentHitsRect, toPath, type Rect } from '../src/core/route.ts';

const box = (x: number, y: number, w = 160, h = 56): Rect => ({ x, y, w, h });

describe('segmentHitsRect', () => {
  it('sees a line passing straight through a box', () => {
    expect(segmentHitsRect({ x: 0, y: 30 }, { x: 300, y: 30 }, box(100, 0))).toBe(true);
  });

  it('does not count a line running clear above it', () => {
    expect(segmentHitsRect({ x: 0, y: -40 }, { x: 300, y: -40 }, box(100, 0))).toBe(false);
  });

  it('does not count a line merely touching the border', () => {
    // Otherwise every link would "collide" with the box it leaves from.
    expect(segmentHitsRect({ x: 0, y: 0 }, { x: 300, y: 0 }, box(100, 0))).toBe(false);
  });
});

describe('elbowRoute', () => {
  it('produces an orthogonal path: every segment is horizontal or vertical', () => {
    const pts = elbowRoute(box(0, 0), box(500, 300), []);
    for (let i = 1; i < pts.length; i++) {
      const dx = Math.abs(pts[i]!.x - pts[i - 1]!.x);
      const dy = Math.abs(pts[i]!.y - pts[i - 1]!.y);
      expect(dx < 0.5 || dy < 0.5, `segment ${i} is diagonal`).toBe(true);
    }
  });

  it('routes around a box sitting directly between the two ends', () => {
    const from = box(0, 100), to = box(600, 100);
    const blocker = box(280, 60);
    const pts = elbowRoute(from, to, [blocker]);
    expect(pathHitsAny(pts, [blocker]), 'route cuts through the blocking box').toBe(false);
  });

  it('still clears the obstacle when boxes are packed either side of it', () => {
    // The naive "slide to the nearest face" move fails here: it pushes the line into a
    // neighbour, which is why both sides are scored against every obstacle.
    const from = box(0, 100), to = box(800, 100);
    const obstacles = [box(280, 60), box(280, -40), box(280, 160)];
    const pts = elbowRoute(from, to, obstacles);
    expect(pathHitsAny(pts, obstacles)).toBe(false);
  });

  it('starts at the source box and ends at the target box', () => {
    const from = box(0, 0), to = box(400, 0);
    const pts = elbowRoute(from, to, []);
    const first = pts[0]!, last = pts[pts.length - 1]!;
    expect(first.x).toBeCloseTo(from.x + from.w, 1); // leaves the right face
    expect(last.x).toBeCloseTo(to.x, 1);             // arrives at the left face
  });
});

describe('freeRoute', () => {
  it('goes straight when nothing is in the way', () => {
    const r = freeRoute(box(0, 0), box(400, 0), []);
    expect(r.points).toHaveLength(2);
  });

  it('falls back to right angles rather than cutting through a box', () => {
    const blocker = box(200, -20);
    const r = freeRoute(box(0, 0), box(500, 0), [blocker]);
    expect(r.points.length).toBeGreaterThan(2);
    expect(pathHitsAny(r.points, [blocker])).toBe(false);
  });
});

describe('nudgeClearOfBoxes', () => {
  it('never moves the first or last segment', () => {
    // Those are the stubs leaving and entering a box; moving either detaches the line.
    const pts = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 100 }, { x: 40, y: 100 }, { x: 60, y: 100 }];
    const out = nudgeClearOfBoxes(pts, [box(10, 40, 40, 40)]);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
  });

  it('leaves an already-clear path untouched', () => {
    const pts = [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 100 }, { x: 40, y: 100 }];
    expect(nudgeClearOfBoxes(pts, [box(500, 500)])).toEqual(pts);
  });
});

describe('toPath', () => {
  it('draws a plain line for two points', () => {
    expect(toPath([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBe('M0,0 L10,0');
  });

  it('rounds the corners of an elbow instead of leaving hard steps', () => {
    const d = toPath([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }]);
    expect(d).toContain('Q'); // a quadratic curve at the turn
  });
});
