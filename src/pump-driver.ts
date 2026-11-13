// element: pump-driver (req: R2)

/** Switches the water pump and refuses to run it longer than a safety limit. */
export class PumpDriver {
  private running = false;
  private startedAt = 0;

  constructor(
    private readonly maxRunMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  isRunning(): boolean {
    return this.running;
  }

  /** Starts the pump. Returns false if it was already running. */
  start(): boolean {
    if (this.running) return false;
    this.running = true;
    this.startedAt = this.now();
    return true;
  }

  /** Stops the pump. Returns false if it was already stopped. */
  stop(): boolean {
    if (!this.running) return false;
    this.running = false;
    return true;
  }

  /** Call periodically. Stops the pump once it has run past the safety limit. */
  tick(): void {
    if (this.running && this.now() - this.startedAt >= this.maxRunMs) this.stop();
  }
}
