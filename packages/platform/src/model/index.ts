import type { OpenAI } from "openai";
import type { ModelRequest, ModelResponse } from "@chat/agent";
import { openAiComplete } from "./openai";

export type {
  ModelOperation,
  ModelRequest,
  ModelResponse,
  ModelUsage,
  UsageKind,
  UsageRecord,
} from "@chat/agent";
export { withForkUsage, withUsageRecorder } from "./usage-recorder";

export class Model {
  private constructor(
    private readonly completeImpl: (request: ModelRequest) => Promise<ModelResponse>,
  ) {}

  static fromOpenAI(client: OpenAI): Model {
    return new Model((request) => openAiComplete(client, request));
  }

  complete(request: ModelRequest): Promise<ModelResponse> {
    return this.completeImpl(request);
  }
}
