// element: scheduler (req: R3)

/** Fires a callback at fixed times of day, given as "HH:MM" strings. */
export class Scheduler {
  private readonly times: string[];
  private lastFired = '';

  constructor(times: string[], private readonly trigger: () => void) {
    for (const t of times) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) throw new Error(`Invalid time: ${t}`);
    }
    this.times = [...times];
  }

  /** Call once per minute or faster. Fires at most once per scheduled minute. */
  tick(date: Date): boolean {
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const key = `${date.toDateString()} ${hh}:${mm}`;
    if (!this.times.includes(`${hh}:${mm}`) || key === this.lastFired) return false;
    this.lastFired = key;
    this.trigger();
    return true;
  }
}
