export interface TokenCounts {
  input: number;
  output: number;
  cached: number;
}

const PRICES: Record<string, { input: number; cached: number; output: number }> = {
  "gpt-4o": { input: 2.5, cached: 1.25, output: 10 },
  "gpt-4o-mini": { input: 0.15, cached: 0.075, output: 0.6 },
  "text-embedding-3-small": { input: 0.02, cached: 0.02, output: 0 },
};

export function estimateCost(model: string, tokens: TokenCounts): number | undefined {
  const price = PRICES[model];
  if (!price) return undefined;
  const uncachedInput = Math.max(0, tokens.input - tokens.cached);
  return (
    (uncachedInput * price.input + tokens.cached * price.cached + tokens.output * price.output) /
    1_000_000
  );
}
