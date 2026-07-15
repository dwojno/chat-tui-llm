import { describe, expect, it } from "vitest";
import { createSerialQueue } from "@/platform/utils/serial-queue";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const tick = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe("createSerialQueue", () => {
  it("runs tasks one at a time, in enqueue order", async () => {
    const queue = createSerialQueue();
    const order: string[] = [];
    const first = deferred<void>();
    const second = deferred<void>();

    const a = queue.enqueue(async () => {
      order.push("a:start");
      await first.promise;
      order.push("a:end");
    });
    const b = queue.enqueue(async () => {
      order.push("b:start");
      await second.promise;
      order.push("b:end");
    });

    await tick();
    expect(order).toEqual(["a:start"]);

    first.resolve();
    await a;
    await tick();
    expect(order).toEqual(["a:start", "a:end", "b:start"]);

    second.resolve();
    await b;
    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("returns each task's own result", async () => {
    const queue = createSerialQueue();
    const one = queue.enqueue(async () => 1);
    const two = queue.enqueue(async () => 2);
    expect(await one).toBe(1);
    expect(await two).toBe(2);
  });

  it("isolates a rejection so later tasks still run", async () => {
    const queue = createSerialQueue();
    const failing = queue.enqueue(async () => {
      throw new Error("boom");
    });
    const after = queue.enqueue(async () => "ok");

    await expect(failing).rejects.toThrow("boom");
    expect(await after).toBe("ok");
  });
});
