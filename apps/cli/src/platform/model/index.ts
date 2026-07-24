import type { OpenAI } from "openai";
import { openAiComplete } from "./openai";
import type { ModelRequest, ModelResponse } from "./types";

export type {
  ModelOperation,
  ModelRequest,
  ModelResponse,
  ModelUsage,
  UsageKind,
  UsageRecord,
} from "./types";
export { withForkUsage, withUsageRecorder } from "./usage-recorder";

export class Model {
  private constructor(
    private readonly completeImpl: (request: ModelRequest) => Promise<ModelResponse>,
  ) {}

  static fromOpenAI(client: OpenAI): Model {
    return new Model((request) => openAiComplete(client, request));
  }

  static fromAnthropic(_client: unknown): Model {
    throw new Error("Model.fromAnthropic is not implemented yet");
  }

  complete(request: ModelRequest): Promise<ModelResponse> {
    return this.completeImpl(request);
  }
}
