import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { END, START, parse, print, type StateDiagram, type StateNode, type StateTransition } from '../src/core/state';

const SAMPLE = `@startuml watering-controller
' id: idle
' req: R1
state "Idle" as Idle

' id: watering
' req: R1, R2
state "Watering" as Watering

' id: skipped
' req: R7
' status: proposed
state "Skipped" as Skipped

[*] --> Idle
Idle --> Watering : moisture low
Watering --> Idle : moisture ok
Idle ..> Skipped : rain forecast
Skipped --> Idle : window passed
Watering --> [*]
@enduml
`;

describe('parse (state)', () => {
  it('reads the watering-controller sample', () => {
    const d = parse(SAMPLE);
    expect(d.title).toBe('watering-controller');
    expect(d.states.map((s) => s.id)).toEqual(['idle', 'watering', 'skipped']);
    expect(d.states[2]).toMatchObject({ status: 'proposed', req: ['R7'] });
    expect(d.transitions).toHaveLength(6);
    expect(d.transitions[0]).toEqual({ from: START, to: 'idle', label: '', proposed: false });
    expect(d.transitions.find((t) => t.to === END)).toMatchObject({ from: 'watering' });
    expect(d.transitions.find((t) => t.to === 'skipped')).toMatchObject({ proposed: true, label: 'rain forecast' });
  });

  it('drops a transition between two [*] tokens', () => {
    const d = parse('@startuml\nstate "A" as A\n[*] --> [*]\n@enduml');
    expect(d.transitions).toHaveLength(0);
  });

  it('drops a transition to an undeclared state', () => {
    const d = parse('@startuml\nstate "A" as A\nA --> Ghost\n@enduml');
    expect(d.transitions).toHaveLength(0);
  });
});

describe('print (state)', () => {
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
const status = fc.constantFrom('proposed', 'approved', 'modified') as fc.Arbitrary<StateNode['status']>;

const arbDiagram: fc.Arbitrary<StateDiagram> = fc
  .uniqueArray(fc.tuple(kebab, word), {
    minLength: 1, maxLength: 6,
    comparator: (a, b) => a[0] === b[0] || a[1] === b[1],
  })
  .chain((pairs) => {
    const states: fc.Arbitrary<StateNode[]> = fc.tuple(
      ...pairs.map(([id, alias]) =>
        fc.record({ id: fc.constant(id), name: fc.oneof(fc.constant(alias), label), alias: fc.constant(alias), req, status }),
      ),
    );
    // `[*]` is one token standing for two different pseudostates depending on which side
    // of the arrow it sits on (real PlantUML's own rule, and Diagraph's too): on the left
    // it can only mean "initial" (from), on the right only "final" (to) — parse() never
    // produces from=END or to=START from real text, so the generator should not either.
    // `[*] --> [*]` is the one case even real PlantUML treats as ambiguous and drops.
    const ids = pairs.map((p) => p[0]);
    const transition: fc.Arbitrary<StateTransition> = fc.record({
      from: fc.constantFrom(...ids, START),
      to: fc.constantFrom(...ids, END),
      label: fc.oneof(fc.constant(''), label),
      proposed: fc.boolean(),
    }).filter((t) => !(t.from === START && t.to === END));
    return fc.record({
      title: fc.oneof(fc.constant(''), word),
      states,
      transitions: fc.array(transition, { maxLength: 8 }),
    });
  });

describe('round trip (property, state)', () => {
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
