import { isBrokenCircuitError } from "cockatiel";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createResiliencePolicy, isRetryableError } from "@/platform/utils/resilience";

function httpError(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

const FAST = { initialDelayMs: 10, maxDelayMs: 50, jitter: false } as const;

describe("isRetryableError", () => {
  it("retries HTTP 429 and 5xx but not other 4xx", () => {
    expect(isRetryableError(httpError(429))).toBe(true);
    expect(isRetryableError(httpError(503))).toBe(true);
    expect(isRetryableError(httpError(400))).toBe(false);
    expect(isRetryableError(httpError(404))).toBe(false);
  });

  it("retries network-shaped errors", () => {
    expect(isRetryableError(new TypeError("fetch failed"))).toBe(true);
    expect(isRetryableError(new Error("connect ECONNREFUSED 127.0.0.1:6333"))).toBe(true);
  });

  it("does not retry an unclassifiable error", () => {
    expect(isRetryableError(new Error("bad request payload"))).toBe(false);
    expect(isRetryableError({ nope: true })).toBe(false);
  });
});

describe("createResiliencePolicy", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries a transient failure then succeeds", async () => {
    const policy = createResiliencePolicy({ maxRetries: 3, ...FAST });
    const fn = vi.fn().mockRejectedValueOnce(httpError(503)).mockResolvedValueOnce("ok");

    const run = policy.execute(fn);
    await vi.advanceTimersByTimeAsync(1000);

    expect(await run).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("gives up after maxRetries and rethrows", async () => {
    const policy = createResiliencePolicy({
      maxRetries: 2,
      breakerThreshold: 10,
      ...FAST,
    });
    const fn = vi.fn().mockRejectedValue(httpError(503));

    let error: unknown;
    const run = policy.execute(fn).catch((caught: unknown) => {
      error = caught;
    });
    await vi.advanceTimersByTimeAsync(1000);
    await run;

    expect(error).toBeInstanceOf(Error);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-retryable error", async () => {
    const policy = createResiliencePolicy({ maxRetries: 3, ...FAST });
    const fn = vi.fn().mockRejectedValue(httpError(400));

    await expect(policy.execute(fn)).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("opens the circuit after consecutive failures and then fails fast", async () => {
    const policy = createResiliencePolicy({
      maxRetries: 5,
      breakerThreshold: 2,
      ...FAST,
    });
    const fn = vi.fn().mockRejectedValue(httpError(503));

    const first = policy.execute(fn).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(1000);
    await first;
    expect(fn).toHaveBeenCalledTimes(2);

    let openError: unknown;
    await policy.execute(fn).catch((error: unknown) => {
      openError = error;
    });
    expect(isBrokenCircuitError(openError)).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
