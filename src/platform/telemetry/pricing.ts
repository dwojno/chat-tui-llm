import { Model } from "@/app/config";

export interface TokenCounts {
  input: number;
  output: number;
  cached: number;
}

interface Price {
  input: number;
  cached: number;
  output: number;
}

const PRICES: Record<Model | string, Price | undefined> = {
  "gpt-5.6-luna": { input: 1.0, cached: 0.1, output: 6.0 },
  "gpt-4.1-nano": { input: 0.1, cached: 0.025, output: 0.4 },
  "gpt-4o-mini": { input: 0.15, cached: 0.075, output: 0.6 },
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
