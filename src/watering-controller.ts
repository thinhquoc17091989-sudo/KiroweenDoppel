// element: watering-controller (req: R1, R2)
import type { MoistureReading } from './moisture-reading';
import type { PumpDriver } from './pump-driver';

/** Decides when to water from the latest moisture reading and the schedule. */
export class WateringController {
  private latest: MoistureReading | undefined;

  /**
   * @param pump pump to command
   * @param dryBelowPercent water when moisture is below this value
   */
  constructor(
    private readonly pump: Pick<PumpDriver, 'start' | 'stop'>,
    private readonly dryBelowPercent = 30,
  ) {}

  /** Stores the newest reading and stops the pump once the soil is wet enough. */
  onReading(reading: MoistureReading): void {
    this.latest = reading;
    if (reading.percent >= this.dryBelowPercent) this.pump.stop();
  }

  /** Called by the scheduler. Starts the pump only if the soil is dry. Returns true if it started. */
  onScheduleTrigger(): boolean {
    if (!this.latest || this.latest.percent >= this.dryBelowPercent) return false;
    return this.pump.start();
  }
}
