import { AUTOSAVE_MILLISECONDS } from "@doompile/core";
/** Serializes writes and coalesces typing bursts without dropping a newer edit. */
export class Autosave<T> {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: T | undefined;
  private running: Promise<void> | undefined;
  constructor(
    private write: (value: T) => Promise<void>,
    private onError: (error: unknown) => void,
    private delay = AUTOSAVE_MILLISECONDS,
  ) {}
  schedule(value: T) {
    this.pending = value;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush().catch(this.onError);
    }, this.delay);
  }
  flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.running) return this.running;
    // Defer draining one microtask so concurrent flush calls share the full drain.
    this.running = Promise.resolve()
      .then(async () => {
        while (this.pending !== undefined) {
          const value = this.pending;
          this.pending = undefined;
          try {
            await this.write(value);
          } catch (error) {
            if (this.pending === undefined) this.pending = value;
            throw error;
          }
        }
      })
      .finally(() => {
        this.running = undefined;
        if (this.pending === undefined) clearTimeout(this.timer);
      });
    return this.running;
  }
}
