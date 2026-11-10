import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from '../src/core/puml';
import { accept, approvedOnly, refreshLinkStatus, reject, rename } from '../src/core/review';
import { arrangeAll, mergeLayout } from '../src/core/layout';

const base = () => {
  const m = parse(readFileSync('samples/plant-watering/proposals.puml', 'utf8'));
  return refreshLinkStatus({ ...m, elements: m.elements.map((e) => ({ ...e, status: 'proposed' as const })) });
};

describe('review actions', () => {
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
    const withNew = { ...m, elements: [...m.elements, { id: 'logger', kind: 'component' as const, name: 'Logger', alias: 'Logger', req: [], status: 'proposed' as const }],
      links: [...m.links, { from: 'pump-driver', to: 'logger', label: '', proposed: true }] };
    const merged = mergeLayout(withNew, moved);
    expect(merged['pump-driver']).toEqual({ x: 999, y: 999 });
    expect(merged['logger']).toBeDefined();
    expect(merged['logger']!.x).toBeGreaterThan(999);
  });
});
