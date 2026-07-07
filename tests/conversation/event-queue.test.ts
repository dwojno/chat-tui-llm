import { describe, expect, it } from "vitest";
import { EventQueue } from "../../src/conversation/event-queue";

/** Drain a queue to completion, collecting everything it yields. */
async function drainAll<T>(queue: EventQueue<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of queue.drain()) out.push(item);
  return out;
}

describe("EventQueue", () => {
  it("yields pushed items and completes when the sole producer closes", async () => {
    const queue = new EventQueue<number>();
    queue.open();
    const collected = drainAll(queue);

    queue.push(1);
    queue.push(2);
    queue.close();

    expect(await collected).toEqual([1, 2]);
  });

  it("drains items buffered before the consumer starts", async () => {
    const queue = new EventQueue<string>();
    queue.open();
    queue.push("a");
    queue.push("b");
    queue.close();

    // Consumer starts after everything was already pushed and closed.
    expect(await drainAll(queue)).toEqual(["a", "b"]);
  });

  it("stays open until every producer closes", async () => {
    const queue = new EventQueue<string>();
    queue.open();
    queue.open();
    const collected = drainAll(queue);

    queue.push("p1");
    queue.close(); // one producer done — must NOT end the drain
    queue.push("p2");
    queue.close(); // last producer done — now it ends

    expect(await collected).toEqual(["p1", "p2"]);
  });

  it("completes immediately when a producer opens and closes with nothing", async () => {
    const queue = new EventQueue<number>();
    queue.open();
    queue.close();
    expect(await drainAll(queue)).toEqual([]);
  });
});
