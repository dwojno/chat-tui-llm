import type { z } from "zod";
import type { ForkProfiles, ToolDefinition } from "../tools/types";

export type AgentConfig = {
  instructions?: string;
  tools?: ToolDefinition<z.ZodType>[];
  forkProfiles?: ForkProfiles;
  cacheKey?: string;
};
