import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { END, START, parse, print, type ActivityDiagram, type ActivityEdge, type ActivityNode } from '../src/core/activity';

const SAMPLE = `@startuml skip-watering-decision
' id: check-moisture
' req: R1
action "Check moisture" as CheckMoisture

' id: rain-decision
' req: R7
' status: proposed
decision "Rain forecast?" as RainDecision

' id: skip-watering
' req: R7
' status: proposed
action "Skip and log reason" as SkipWatering

' id: run-pump
' req: R2
action "Run pump" as RunPump

start --> CheckMoisture
CheckMoisture ..> RainDecision
RainDecision ..> SkipWatering : yes
RainDecision --> RunPump : no
SkipWatering --> end
RunPump --> end
@enduml
`;

describe('parse (activity)', () => {
  it('reads the skip-watering-decision sample', () => {
    const d = parse(SAMPLE);
    expect(d.title).toBe('skip-watering-decision');
    expect(d.nodes.map((n) => n.id)).toEqual(['check-moisture', 'rain-decision', 'skip-watering', 'run-pump']);
    expect(d.nodes[1]).toMatchObject({ kind: 'decision', status: 'proposed' });
    expect(d.edges).toHaveLength(6);
    expect(d.edges[0]).toEqual({ from: START, to: 'check-moisture', label: '', proposed: false });
    expect(d.edges.find((e) => e.to === END && e.from === 'run-pump')).toBeDefined();
    expect(d.edges.find((e) => e.label === 'yes')).toMatchObject({ proposed: true });
  });

  it('drops an edge to an undeclared node', () => {
    const d = parse('@startuml\naction "A" as A\nA --> Ghost\n@enduml');
    expect(d.edges).toHaveLength(0);
  });
});

describe('print (activity)', () => {
  it('is stable', () => {
    const once = print(parse(SAMPLE));
    expect(print(parse(once))).toBe(once);
  });
});

// ---------- property-based round trip ----------

const word = fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,10}$/);
const kebab = fc.stringMatching(/^[a-z][a-z0-9]{0,6}(-[a-z0-9]{1,5}){0,2}$/);
const req = fc.array(fc.stringMatching(/^R[1-9][0-9]?$/), { maxLength: 3 }).map((a) => [...new Set(a)]);
const label = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,18}[A-Za-z0-9]$/).map((s) => s.trim());
const status = fc.constantFrom('proposed', 'approved', 'modified') as fc.Arbitrary<ActivityNode['status']>;

const arbDiagram: fc.Arbitrary<ActivityDiagram> = fc
  .uniqueArray(fc.tuple(kebab, word), {
    minLength: 1, maxLength: 6,
    comparator: (a, b) => a[0] === b[0] || a[1] === b[1],
  })
  .chain((pairs) => {
    const nodes: fc.Arbitrary<ActivityNode[]> = fc.tuple(
      ...pairs.map(([id, alias]) =>
        fc.record({
          id: fc.constant(id),
          kind: fc.constantFrom('action', 'decision'),
          name: fc.oneof(fc.constant(alias), label),
          alias: fc.constant(alias),
          req, status,
        }) as fc.Arbitrary<ActivityNode>,
      ),
    );
    const endpoints = [...pairs.map((p) => p[0]), START, END];
    const edge: fc.Arbitrary<ActivityEdge> = fc.record({
      from: fc.constantFrom(...endpoints),
      to: fc.constantFrom(...endpoints),
      label: fc.oneof(fc.constant(''), label),
      proposed: fc.boolean(),
    });
    return fc.record({
      title: fc.oneof(fc.constant(''), word),
      nodes,
      edges: fc.array(edge, { maxLength: 8 }),
    });
  });

describe('round trip (property, activity)', () => {
  it('parse(print(d)) deep-equals d', () => {
    fc.assert(fc.property(arbDiagram, (d) => { expect(parse(print(d))).toEqual(d); }), { numRuns: 300 });
  });
  it('print is idempotent over parse', () => {
    fc.assert(fc.property(arbDiagram, (d) => {
      const t = print(d);
      expect(print(parse(t))).toBe(t);
    }), { numRuns: 200 });
  });
});
