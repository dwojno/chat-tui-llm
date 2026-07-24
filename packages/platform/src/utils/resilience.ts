import {
  circuitBreaker,
  ConsecutiveBreaker,
  ExponentialBackoff,
  handleWhen,
  isBrokenCircuitError,
  noJitterGenerator,
  retry,
  wrap,
} from "cockatiel";

export interface ResiliencePolicy {
  execute<T>(fn: () => Promise<T>): Promise<T>;
}

export interface ResilienceOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  breakerThreshold?: number;
  halfOpenAfterMs?: number;
  jitter?: boolean;
}

const DEFAULTS = {
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 8_000,
  breakerThreshold: 5,
  halfOpenAfterMs: 10_000,
  jitter: true,
} satisfies Required<ResilienceOptions>;

function httpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const record = error as { status?: unknown; response?: { status?: unknown } };
  const status = record.status ?? record.response?.status;
  return typeof status === "number" ? status : undefined;
}

const NETWORK_MARKERS = ["fetch failed", "econn", "etimedout", "socket hang up", "network"];

function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return NETWORK_MARKERS.some((marker) => message.includes(marker));
}

export function isRetryableError(error: unknown): boolean {
  if (isBrokenCircuitError(error)) return false;
  const status = httpStatus(error);
  if (status !== undefined) return status === 429 || status >= 500;
  return isNetworkError(error);
}

export function createResiliencePolicy(options: ResilienceOptions = {}): ResiliencePolicy {
  const config = { ...DEFAULTS, ...options };
  const handler = handleWhen(isRetryableError);
  const backoff = new ExponentialBackoff({
    initialDelay: config.initialDelayMs,
    maxDelay: config.maxDelayMs,
    ...(config.jitter ? {} : { generator: noJitterGenerator }),
  });
  const retryPolicy = retry(handler, { maxAttempts: config.maxRetries, backoff });
  const breaker = circuitBreaker(handler, {
    halfOpenAfter: config.halfOpenAfterMs,
    breaker: new ConsecutiveBreaker(config.breakerThreshold),
  });
  const policy = wrap(retryPolicy, breaker);
  return { execute: (fn) => policy.execute(fn) };
}
