import { describe, expect, it } from 'vitest';
import { PumpDriver } from '../src/pump-driver';

describe('PumpDriver', () => {
  it('starts and stops, reporting no-ops', () => {
    const pump = new PumpDriver();
    expect(pump.start()).toBe(true);
    expect(pump.start()).toBe(false);
    expect(pump.isRunning()).toBe(true);
    expect(pump.stop()).toBe(true);
    expect(pump.stop()).toBe(false);
    expect(pump.isRunning()).toBe(false);
  });

  it('stops itself after the safety limit', () => {
    let t = 0;
    const pump = new PumpDriver(1000, () => t);
    pump.start();
    t = 999;
    pump.tick();
    expect(pump.isRunning()).toBe(true);
    t = 1000;
    pump.tick();
    expect(pump.isRunning()).toBe(false);
  });
});
