// element: moisture-sensor (req: R1)
import type { MoistureReading } from './moisture-reading';

/** Converts raw analog readings into moisture readings. */
export class MoistureSensor {
  /**
   * @param rawDry raw value measured in dry soil
   * @param rawWet raw value measured in saturated soil
   * @param now clock, replaceable in tests
   */
  constructor(
    private readonly rawDry = 1023,
    private readonly rawWet = 300,
    private readonly now: () => number = Date.now,
  ) {}

  /** Maps a raw value onto 0..100 percent and clamps it to that range. */
  read(raw: number): MoistureReading {
    const span = this.rawDry - this.rawWet;
    const percent = ((this.rawDry - raw) / span) * 100;
    return { percent: Math.min(100, Math.max(0, percent)), takenAt: this.now() };
  }
}
