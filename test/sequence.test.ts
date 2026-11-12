import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parse, print, type SeqMessage, type SeqParticipant, type SequenceDiagram } from '../src/core/sequence';
import { idOf } from '../src/core/dsl';

const SAMPLE = `@startuml skip-watering-on-rain
participant "Scheduler" as Scheduler
participant "WateringController" as WateringController
participant "WeatherForecast" as WeatherForecast
participant "PumpDriver" as PumpDriver

' id: tick
' req: R3
Scheduler -> WateringController : tick

' id: get-forecast
' req: R7
' status: proposed
WateringController ..> WeatherForecast : getForecast

' id: forecast-reply
' req: R7
' status: proposed
WeatherForecast ..> WateringController : rain within 12h true

' id: run-pump
' req: R2
WateringController -> PumpDriver : run
@enduml
`;

describe('parse (sequence)', () => {
  it('reads the skip-watering-on-rain sample', () => {
    const d = parse(SAMPLE);
    expect(d.title).toBe('skip-watering-on-rain');
    expect(d.participants.map((p) => p.alias)).toEqual(['Scheduler', 'WateringController', 'WeatherForecast', 'PumpDriver']);
    expect(d.messages).toHaveLength(4);
    expect(d.messages[0]).toMatchObject({ id: 'tick', label: 'tick', status: 'approved' });
    expect(d.messages[1]).toMatchObject({ id: 'get-forecast', status: 'proposed', req: ['R7'] });
  });

  it('drops a message between an undeclared participant', () => {
    const d = parse('@startuml\nparticipant "A" as A\nA -> Ghost : x\n@enduml');
    expect(d.messages).toHaveLength(0);
  });

  it('numbers messages without an explicit id sequentially', () => {
    const d = parse('@startuml\nparticipant "A" as A\nparticipant "B" as B\nA -> B : one\nA -> B : two\n@enduml');
    expect(d.messages.map((m) => m.id)).toEqual(['msg-1', 'msg-2']);
  });
});

describe('print (sequence)', () => {
  it('is stable', () => {
    const once = print(parse(SAMPLE));
    expect(print(parse(once))).toBe(once);
  });
});

// ---------- property-based round trip ----------

const word = fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,10}$/);
const req = fc.array(fc.stringMatching(/^R[1-9][0-9]?$/), { maxLength: 3 }).map((a) => [...new Set(a)]);
const label = fc.stringMatching(/^[A-Za-z][A-Za-z0-9 ]{0,18}[A-Za-z0-9]$/).map((s) => s.trim());
const status = fc.constantFrom('proposed', 'approved', 'modified') as fc.Arbitrary<SeqMessage['status']>;
const msgId = fc.stringMatching(/^[a-z][a-z0-9]{0,8}(-[a-z0-9]{1,6}){0,2}$/);

const arbDiagram: fc.Arbitrary<SequenceDiagram> = fc
  .uniqueArray(word, { minLength: 2, maxLength: 5 }) // at least two participants, so a message can have distinct ends
  .chain((aliases) => {
    // SeqParticipant.id is never independent data: parse() always derives it from the
    // alias via idOf, so the arbitrary has to compute it the same way, not invent one.
    const participants: fc.Arbitrary<SeqParticipant[]> = fc.tuple(
      ...aliases.map((alias) => fc.record({ id: fc.constant(idOf(alias)), name: fc.oneof(fc.constant(alias), label), alias: fc.constant(alias) })),
    );
    const ids = aliases.map((alias) => idOf(alias));
    const message: fc.Arbitrary<SeqMessage> = fc.record({
      id: msgId,
      from: fc.constantFrom(...ids),
      to: fc.constantFrom(...ids),
      label: fc.oneof(fc.constant(''), label),
      req, status,
    });
    return fc
      .record({
        title: fc.oneof(fc.constant(''), word),
        participants,
        messages: fc.array(message, { maxLength: 8 }),
      })
      .map((d) => ({
        ...d,
        // message ids must be unique, same constraint a reviewer's real diagram would need
        messages: d.messages.filter((m, i, arr) => arr.findIndex((x) => x.id === m.id) === i),
      }));
  });

describe('round trip (property, sequence)', () => {
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
