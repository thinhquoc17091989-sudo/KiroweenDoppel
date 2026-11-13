import { describe, expect, it } from 'vitest';
import { WateringController } from '../src/watering-controller';
import { PumpDriver } from '../src/pump-driver';

const reading = (percent: number) => ({ percent, takenAt: 0 });

describe('WateringController', () => {
  it('does not water before it has a reading', () => {
    const pump = new PumpDriver();
    expect(new WateringController(pump).onScheduleTrigger()).toBe(false);
    expect(pump.isRunning()).toBe(false);
  });

  it('waters on schedule when the soil is dry', () => {
    const pump = new PumpDriver();
    const c = new WateringController(pump, 30);
    c.onReading(reading(10));
    expect(c.onScheduleTrigger()).toBe(true);
    expect(pump.isRunning()).toBe(true);
  });

  it('skips watering when the soil is wet, and stops the pump once wet', () => {
    const pump = new PumpDriver();
    const c = new WateringController(pump, 30);
    c.onReading(reading(10));
    c.onScheduleTrigger();
    c.onReading(reading(60));
    expect(pump.isRunning()).toBe(false);
    expect(c.onScheduleTrigger()).toBe(false);
  });
});
