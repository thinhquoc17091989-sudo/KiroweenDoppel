import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse as parseState, print as printState } from '../src/core/state';
import { parse as parseActivity, print as printActivity } from '../src/core/activity';
import { parse as parseSequence, print as printSequence } from '../src/core/sequence';

describe('Kiro-drafted samples parse correctly and round-trip', () => {
  it('watering-controller.state.puml', () => {
    const text = readFileSync('samples/plant-watering/watering-controller.state.puml', 'utf8');
    const d = parseState(text);
    expect(d.states.map((s) => s.id)).toEqual(['idle', 'watering', 'skipped']);
    expect(d.states.find((s) => s.id === 'skipped')).toMatchObject({ status: 'proposed', req: ['R8'] });
    expect(d.states.find((s) => s.id === 'idle')).toMatchObject({ status: 'approved' });
    expect(d.transitions).toHaveLength(6);
    expect(d.transitions.find((t) => t.to === 'skipped')).toMatchObject({ proposed: true, label: 'rain forecast' });
    const once = printState(d);
    expect(printState(parseState(once))).toBe(once); // stable
  });

  it('skip-watering-decision.activity.puml', () => {
    const text = readFileSync('samples/plant-watering/skip-watering-decision.activity.puml', 'utf8');
    const d = parseActivity(text);
    expect(d.nodes.map((n) => n.id)).toEqual(['check-moisture', 'rain-decision', 'skip-watering', 'run-pump']);
    expect(d.nodes.find((n) => n.id === 'rain-decision')).toMatchObject({ kind: 'decision', status: 'proposed' });
    expect(d.edges).toHaveLength(6);
    expect(d.edges.find((e) => e.label === 'yes')).toMatchObject({ proposed: true });
    const once = printActivity(d);
    expect(printActivity(parseActivity(once))).toBe(once);
  });

  it('skip-watering-on-rain.seq.puml', () => {
    const text = readFileSync('samples/plant-watering/skip-watering-on-rain.seq.puml', 'utf8');
    const d = parseSequence(text);
    expect(d.participants.map((p) => p.alias)).toEqual(['Scheduler', 'WateringController', 'WeatherForecast', 'PumpDriver']);
    expect(d.messages).toHaveLength(4);
    expect(d.messages.map((m) => m.id)).toEqual(['tick', 'get-forecast', 'forecast-reply', 'run-pump-msg']);
    expect(d.messages.find((m) => m.id === 'get-forecast')).toMatchObject({ status: 'proposed', req: ['R8'] });
    const once = printSequence(d);
    expect(printSequence(parseSequence(once))).toBe(once);
  });
});
