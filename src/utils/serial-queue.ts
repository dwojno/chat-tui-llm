/** A FIFO queue that runs async tasks one at a time. */

export interface SerialQueue {
  /**
   * Enqueue a task. It starts only after every previously-enqueued task has
   * settled, and its own result is returned. A task's rejection is isolated: it
   * rejects only this call, never blocking or breaking tasks queued after it.
   */
  enqueue<T>(task: () => Promise<T>): Promise<T>;
}

export function createSerialQueue(): SerialQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    enqueue(task) {
      const result = tail.then(task);
      tail = result.catch(() => undefined);
      return result;
    },
  };
}
