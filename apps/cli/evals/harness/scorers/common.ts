import { createScorer } from "evalite";
import type { z } from "zod";
import type { ProbeResult } from "../probe";

export interface Expected {
  route?: "direct" | (string & {});
  toolArg?: { key: string; contains: string };
  conciseArg?: { key: string; maxWords: number };
  forbidTools?: string[];
  mustContain?: string[];
  mustOmit?: string[];
  schema?: z.ZodType;
  allowRefusal?: boolean;
  maxWords?: number;
  judge?: string;
}

export const isAbsent = <T>(value: T | undefined): value is undefined => value === undefined;

export const notApplicable = { score: 1, metadata: { note: "n/a" } };

export const lowercase = (text: string) => text.toLowerCase();

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const containsTerm = (haystack: string, term: string) =>
  new RegExp(`\\b${escapeRegExp(term)}`, "i").test(haystack);

export type Scorer = ReturnType<typeof createScorer<unknown, ProbeResult, Expected>>;

export const defineScorer = (
  name: string,
  description: string,
  scorer: Parameters<typeof createScorer<unknown, ProbeResult, Expected>>[0]["scorer"],
): Scorer => createScorer<unknown, ProbeResult, Expected>({ name, description, scorer });
