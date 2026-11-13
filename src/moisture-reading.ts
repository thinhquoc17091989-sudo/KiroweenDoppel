// element: moisture-reading
/** One soil moisture measurement published by the sensor. */
export interface MoistureReading {
  /** Moisture as a percentage, 0 (dry) to 100 (saturated). */
  percent: number;
  /** Time of the measurement, in milliseconds since the Unix epoch. */
  takenAt: number;
}
