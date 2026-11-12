import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { parse, print } from '../src/core/puml';
import type { Element, Link, Model, Note, Status } from '../src/core/model';

const sample = readFileSync('samples/plant-watering/proposals.puml', 'utf8');

describe('parse', () => {
  it('reads the plant-watering sample', () => {
    const m = parse(sample);
    expect(m.title).toBe('plant-watering');
    expect(m.elements.map((e) => e.id)).toEqual([
      'moisture-sensor', 'watering-controller', 'pump-driver', 'scheduler', 'moisture-reading',
    ]);
    expect(m.elements[1]!.req).toEqual(['R1', 'R2']);
    expect(m.elements[4]!.kind).toBe('interface');
    expect(m.links).toHaveLength(4);
    expect(m.links.every((l) => l.proposed)).toBe(true);
    expect(m.links[2]).toEqual({ from: 'watering-controller', to: 'pump-driver', label: 'commands', proposed: true });
    expect(m.notes).toEqual([{ target: 'watering-controller', side: 'right', lines: [
      'Decides when to water from', 'moisture level and schedule.',
    ] }]);
  });

  it('derives id and alias when they are missing', () => {
    const m = parse('@startuml\ncomponent "Pump Driver"\ncomponent Foo\nPumpDriver --> Foo\n@enduml');
    expect(m.elements[0]).toMatchObject({ id: 'pump-driver', alias: 'PumpDriver', name: 'Pump Driver' });
    expect(m.elements[1]).toMatchObject({ id: 'foo', alias: 'Foo' });
    expect(m.links).toHaveLength(1);
  });

  it('drops links to unknown aliases, skinparam blocks and directives', () => {
    const m = parse('@startuml\nskinparam component {\n  BackgroundColor red\n}\nhide stereotypes\ncomponent A\nA --> Ghost\n@enduml');
    expect(m.elements).toHaveLength(1);
    expect(m.links).toHaveLength(0);
  });
});

describe('print', () => {
  it('is stable: print(parse(print(parse(sample)))) == print(parse(sample))', () => {
    const once = print(parse(sample));
    expect(print(parse(once))).toBe(once);
  });
});

// ---------- property-based round trip (R3.2) ----------

const word = fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,11}$/);
const kebab = fc.stringMatching(/^[a-z][a-z0-9]{0,7}(-[a-z0-9]{1,6}){0,2}$/);
const req = fc.array(fc.stringMatching(/^R[1-9][0-9]?$/), { maxLength: 3 }).map((a) => [...new Set(a)]);
const label = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,20}[A-Za-z0-9]$/).map((s) => s.trim());
const noteLine = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ,.]{0,30}[A-Za-z0-9.]$/);
const status: fc.Arbitrary<Status> = fc.constantFrom('proposed', 'approved', 'modified');

const arbModel: fc.Arbitrary<Model> = fc
  .uniqueArray(fc.tuple(kebab, word), {
    minLength: 1, maxLength: 8,
    comparator: (a, b) => a[0] === b[0] || a[1] === b[1],
  })
  .chain((pairs) => {
    const elements: fc.Arbitrary<Element[]> = fc.tuple(
      ...pairs.map(([id, alias]) =>
        fc.record({
          id: fc.constant(id),
          kind: fc.constantFrom('component', 'interface'),
          name: fc.oneof(fc.constant(alias), label),
          alias: fc.constant(alias),
          req,
          status,
        }) as fc.Arbitrary<Element>,
      ),
    );
    const ids = pairs.map((p) => p[0]);
    const link: fc.Arbitrary<Link> = fc.record({
      from: fc.constantFrom(...ids), to: fc.constantFrom(...ids),
      label: fc.oneof(fc.constant(''), label), proposed: fc.boolean(),
    });
    const note: fc.Arbitrary<Note> = fc.record({
      target: fc.constantFrom(...ids),
      side: fc.constantFrom('right', 'left', 'top', 'bottom'),
      lines: fc.array(noteLine, { minLength: 1, maxLength: 3 }),
    });
    return fc.record({
      title: fc.oneof(fc.constant(''), word),
      elements,
      links: fc.array(link, { maxLength: 10 }),
      notes: fc.array(note, { maxLength: 3 }),
    });
  });

describe('round trip (property)', () => {
  it('parse(print(m)) deep-equals m', () => {
    fc.assert(fc.property(arbModel, (m) => { expect(parse(print(m))).toEqual(m); }), { numRuns: 300 });
  });
  it('print is idempotent over parse', () => {
    fc.assert(fc.property(arbModel, (m) => {
      const t = print(m);
      expect(print(parse(t))).toBe(t);
    }), { numRuns: 200 });
  });
});
