import type { z } from "zod";
import type { ToolDefinition } from "../tools/types";

export type AgentConfig = {
  instructions?: string;
  /** Tools the main agent may call. Composed and injected by the host. */
  tools?: ToolDefinition<z.ZodType>[];
  /** Tools available to delegated sub-agents (forks). Injected by the host. */
  forkTools?: ToolDefinition<z.ZodType>[];
  cacheKey?: string;
};
