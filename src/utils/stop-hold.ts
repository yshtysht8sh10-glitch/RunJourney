import { RUN_CONTROL } from '@/utils/run-model';
export class StopHold {
  private started: number | null = null;
  private fired = false;
  begin(now: number) { this.started = now; this.fired = false; }
  cancel() { this.started = null; }
  progress(now: number) { return this.started === null ? 0 : Math.min(1, Math.max(0, (now - this.started) / RUN_CONTROL.holdMs)); }
  complete(now: number) {
    if (this.started === null || this.fired || this.progress(now) < 1) return false;
    this.fired = true; this.started = null; return true;
  }
}
