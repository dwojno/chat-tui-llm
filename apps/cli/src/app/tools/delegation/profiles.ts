import { z } from "zod";
import type { ToolDefinition } from "@/agent/tools/types";
import type { Store } from "@/store";
import { FORK_INSTRUCTIONS } from "../prompts/fork";
import { RAG_FORK_INSTRUCTIONS } from "../prompts/rag-fork";
import { WEB_FORK_INSTRUCTIONS } from "../prompts/web-fork";
import { CODEBASE_FORK_INSTRUCTIONS } from "../prompts/codebase-fork";
import { createRagTools } from "../rag";
import { readFileTool } from "../read-file";
import { webSearchTool } from "../web-search";

export const FORK_PROFILE_NAMES = ["general", "rag_research", "web_research", "codebase"] as const;

export type ForkProfileName = (typeof FORK_PROFILE_NAMES)[number];

interface ForkProfileMeta {
  description: string;
  instructions: string;
  tools: (store: Store) => ToolDefinition<z.ZodType>[];
}

export const FORK_PROFILE_META: Record<ForkProfileName, ForkProfileMeta> = {
  general: {
    description:
      "quick, self-contained one-off tasks (a single fact) — the fallback when no specialist fits",
    instructions: FORK_INSTRUCTIONS,
    tools: () => [webSearchTool],
  },
  rag_research: {
    description: "multi-hop retrieval over this profile's indexed knowledge base",
    instructions: RAG_FORK_INSTRUCTIONS,
    tools: (store) => createRagTools(store),
  },
  web_research: {
    description: "thorough open-web research with cross-checked, cited sources",
    instructions: WEB_FORK_INSTRUCTIONS,
    tools: () => [webSearchTool],
  },
  codebase: {
    description:
      "reading working-directory source files at paths you name (it cannot search or list — name the paths)",
    instructions: CODEBASE_FORK_INSTRUCTIONS,
    tools: () => [readFileTool],
  },
};

const profileMenu = FORK_PROFILE_NAMES.map(
  (name) => `"${name}" — ${FORK_PROFILE_META[name].description}`,
).join("; ");

export const profileArg = z
  .enum(FORK_PROFILE_NAMES)
  .nullable()
  .describe(
    "Which specialized sub-agent to run — pick the one whose focus matches the " +
      `sub-task; null defaults to "general". Options: ${profileMenu}.`,
  );
