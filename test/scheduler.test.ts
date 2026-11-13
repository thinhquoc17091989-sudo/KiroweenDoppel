import { describe, expect, it } from 'vitest';
import { Scheduler } from '../src/scheduler';

describe('Scheduler', () => {
  it('fires once at a scheduled time', () => {
    let count = 0;
    const s = new Scheduler(['07:30'], () => count++);
    expect(s.tick(new Date(2026, 0, 5, 7, 29))).toBe(false);
    expect(s.tick(new Date(2026, 0, 5, 7, 30, 5))).toBe(true);
    expect(s.tick(new Date(2026, 0, 5, 7, 30, 40))).toBe(false);
    expect(count).toBe(1);
  });

  it('fires again the next day', () => {
    let count = 0;
    const s = new Scheduler(['07:30'], () => count++);
    s.tick(new Date(2026, 0, 5, 7, 30));
    s.tick(new Date(2026, 0, 6, 7, 30));
    expect(count).toBe(2);
  });

  it('rejects malformed times', () => {
    expect(() => new Scheduler(['7:5'], () => {})).toThrow('Invalid time');
  });
});
