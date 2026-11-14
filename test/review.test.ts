import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '../src/core/puml';
import { accept, acceptAll, approvedOnly, refreshLinkStatus, reject, rename, setDescription } from '../src/core/review';
import { arrangeAll, mergeLayout } from '../src/core/layout';

const base = () => {
  const m = parse(readFileSync('samples/plant-watering/proposals.puml', 'utf8'));
  return refreshLinkStatus({ ...m, elements: m.elements.map((e) => ({ ...e, status: 'proposed' as const })) });
};

describe('review actions', () => {
  it('acceptAll approves every pending element in one call, leaving already-approved ones alone', () => {
    const m = acceptAll(base());
    expect(m.elements.every((e) => e.status === 'approved')).toBe(true);
    expect(m.links.every((l) => !l.proposed)).toBe(true);
  });

  it('acceptAll never resurrects a rejected element', () => {
    // The actual one-button workflow: reject what you do not want, THEN approve the rest.
    const afterReject = reject(base(), 'scheduler');
    const m = acceptAll(afterReject);
    expect(m.elements.find((e) => e.id === 'scheduler')).toBeUndefined();
    expect(m.elements.every((e) => e.status === 'approved')).toBe(true);
  });

  it('setDescription sets and trims desc without touching status, name or links', () => {
    const before = base();
    const m = setDescription(before, 'pump-driver', '  drives the water pump  ');
    const e = m.elements.find((x) => x.id === 'pump-driver')!;
    expect(e.desc).toBe('drives the water pump');
    expect(e.status).toBe(before.elements.find((x) => x.id === 'pump-driver')!.status);
    expect(e.name).toBe(before.elements.find((x) => x.id === 'pump-driver')!.name);
    expect(m.links).toEqual(before.links);
  });

  it('accept flips status and links become approved only when both ends are', () => {
    let m = accept(base(), 'watering-controller');
    expect(m.links.every((l) => l.proposed)).toBe(true);
    m = accept(m, 'pump-driver');
    const l = m.links.find((x) => x.from === 'watering-controller' && x.to === 'pump-driver')!;
    expect(l.proposed).toBe(false);
  });
  it('reject removes element, its links and notes', () => {
    const m = reject(base(), 'watering-controller');
    expect(m.elements.map((e) => e.id)).not.toContain('watering-controller');
    expect(m.links.some((l) => l.from === 'watering-controller' || l.to === 'watering-controller')).toBe(false);
    expect(m.notes).toHaveLength(0);
  });
  it('rename keeps the id and refreshes the alias, avoiding clashes', () => {
    let m = rename(base(), 'pump-driver', 'Pump Actuator');
    expect(m.elements.find((e) => e.id === 'pump-driver')).toMatchObject({ name: 'Pump Actuator', alias: 'PumpActuator' });
    m = rename(m, 'scheduler', 'Pump Actuator');
    expect(m.elements.find((e) => e.id === 'scheduler')!.alias).toBe('PumpActuator2');
  });
  it('approvedOnly keeps approved elements and the links between them', () => {
    const m = approvedOnly(accept(accept(base(), 'scheduler'), 'watering-controller'));
    expect(m.elements.map((e) => e.id)).toEqual(['watering-controller', 'scheduler']);
    expect(m.links).toEqual([{ from: 'scheduler', to: 'watering-controller', label: 'triggers', proposed: false }]);
  });
});

describe('layout', () => {
  it('arrangeAll puts a target right of its source', () => {
    const l = arrangeAll(base());
    expect(l['scheduler']!.x).toBeLessThan(l['watering-controller']!.x);
    expect(l['watering-controller']!.x).toBeLessThan(l['pump-driver']!.x);
  });
  it('mergeLayout keeps existing positions and only places newcomers', () => {
    const m = base();
    const first = arrangeAll(m);
    const moved = { ...first, 'pump-driver': { x: 999, y: 999 } };
    const withNew = { ...m, elements: [...m.elements, { id: 'logger', kind: 'component' as const, name: 'Logger', alias: 'Logger', req: [], desc: '', status: 'proposed' as const }],
      links: [...m.links, { from: 'pump-driver', to: 'logger', label: '', proposed: true }] };
    const merged = mergeLayout(withNew, moved);
    expect(merged['pump-driver']).toEqual({ x: 999, y: 999 });
    expect(merged['logger']).toBeDefined();
    expect(merged['logger']!.x).toBeGreaterThan(999);
  });
});

describe('layout quality', () => {
  const NODE_H = 56;

  it('never overlaps two elements in the same column', () => {
    const m = base();
    const l = arrangeAll(m);
    const byX = new Map<number, number[]>();
    for (const e of m.elements) {
      const p = l[e.id]!;
      if (!byX.has(p.x)) byX.set(p.x, []);
      byX.get(p.x)!.push(p.y);
    }
    for (const [x, ys] of byX) {
      const sorted = [...ys].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]! - sorted[i - 1]!, `elements overlap in column x=${x}`).toBeGreaterThanOrEqual(NODE_H);
      }
    }
  });

  it('is deterministic: the same model lays out identically every time', () => {
    // A diagram that shuffled between openings would make saved positions and any visual
    // comparison worthless, so ties are broken by declaration order, never by chance.
    const m = base();
    expect(arrangeAll(m)).toEqual(arrangeAll(m));
  });

  it('pulls a linked element towards what points at it', () => {
    // Scheduler -> WateringController is the only link into the controller, so the two
    // should end up roughly level rather than at opposite ends of their columns.
    const m = base();
    const l = arrangeAll(m);
    const gap = Math.abs(l['watering-controller']!.y - l['scheduler']!.y);
    expect(gap, 'a solitary parent and child should line up').toBeLessThan(NODE_H * 2);
  });

  it('leaves room between columns for the widest label crossing the gap', () => {
    const m = base();
    const l = arrangeAll(m);
    const xs = [...new Set(Object.values(l).map((p) => p.x))].sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i]! - xs[i - 1]!, 'columns are too close for their labels').toBeGreaterThan(120);
    }
  });
});
