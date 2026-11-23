/** One in-flight durable snapshot plus one latest cumulative snapshot.
 * Ingestion never waits for disk. Barriers must flush before lifecycle writes. */
export class LatestCheckpoint<T> {
  private pending?: T;
  private flight?: Promise<void>;
  private error?: unknown;
  constructor(private readonly save: (value: T) => Promise<void>, private readonly failed: (error: unknown) => void) {}
  schedule(value: T) { this.pending = value; this.start(); }
  private start() {
    if (this.flight || this.pending === undefined) return;
    this.flight = (async () => {
      while (this.pending !== undefined) {
        const snapshot = this.pending; this.pending = undefined;
        try { await this.save(snapshot); this.error = undefined; }
        catch (error) { this.pending ??= snapshot; this.error = error; this.failed(error); break; }
      }
    })().finally(() => { this.flight = undefined; });
  }
  async flush() {
    this.start();
    while (this.flight) await this.flight;
    if (this.error) throw this.error;
  }
}
