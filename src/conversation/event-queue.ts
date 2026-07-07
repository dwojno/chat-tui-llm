/**
 * A single-consumer async queue for merging events from several concurrent
 * producers into one ordered stream.
 *
 * Each producer calls {@link open} before it starts and {@link close} when it
 * finishes; {@link push} appends an event. {@link drain} yields events as they
 * arrive and completes once every producer has closed and the buffer is empty.
 *
 * Used to fan a delegated sub-agent's tool events up into the parent turn's
 * event stream while several forks run in parallel — the parent generator just
 * `yield*`s {@link drain}.
 */
export class EventQueue<T> {
  private readonly buffer: T[] = [];
  private openProducers = 0;
  private wake?: () => void;

  /** Register a producer; keeps {@link drain} alive until it {@link close}s. */
  open(): void {
    this.openProducers += 1;
  }

  /** Mark a producer done; when the last one closes, {@link drain} can finish. */
  close(): void {
    this.openProducers -= 1;
    this.wake?.();
  }

  push(item: T): void {
    this.buffer.push(item);
    this.wake?.();
  }

  async *drain(): AsyncGenerator<T> {
    while (this.openProducers > 0 || this.buffer.length > 0) {
      if (this.buffer.length > 0) {
        yield this.buffer.shift() as T;
        continue;
      }
      // Buffer empty but producers still open — sleep until one pushes or closes.
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
      this.wake = undefined;
    }
  }
}
