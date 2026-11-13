import { describe, expect, it } from 'vitest';
import { MoistureSensor } from '../src/moisture-sensor';

describe('MoistureSensor', () => {
  const sensor = new MoistureSensor(1000, 200, () => 42);

  it('maps raw values onto percent', () => {
    expect(sensor.read(1000).percent).toBe(0);
    expect(sensor.read(600).percent).toBe(50);
    expect(sensor.read(200).percent).toBe(100);
  });

  it('clamps out-of-range values and stamps the time', () => {
    expect(sensor.read(5000).percent).toBe(0);
    expect(sensor.read(0).percent).toBe(100);
    expect(sensor.read(600).takenAt).toBe(42);
  });
});
