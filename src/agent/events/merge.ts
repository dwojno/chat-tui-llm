class EventQueue<T> {
  private readonly buffer: T[] = [];
  private openProducers = 0;
  private wake?: () => void;

  open(): void {
    this.openProducers += 1;
  }

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
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
      this.wake = undefined;
    }
  }
}

export async function* merge<T, R>(generators: AsyncGenerator<T, R>[]): AsyncGenerator<T, R[]> {
  const queue = new EventQueue<T>();

  const results = generators.map(async (generator) => {
    queue.open();
    try {
      let step = await generator.next();
      while (!step.done) {
        queue.push(step.value);
        step = await generator.next();
      }
      return step.value;
    } finally {
      queue.close();
    }
  });

  yield* queue.drain();
  return await Promise.all(results);
}
