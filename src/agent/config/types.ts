import { OpenAITool } from "../conversation/turn";

export type AgentConfig = {
  instructions?: string;
  tools?: OpenAITool[];
  cacheKey?: string;
};
