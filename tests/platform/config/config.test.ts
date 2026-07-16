import { describe, expect, it } from "vitest";
import { loadConfig } from "@/platform/config";

const base = { OPENAI_API_KEY: "sk-test" };

describe("loadConfig", () => {
  it("groups parsed config by domain with defaults", () => {
    const { model, tools, security, rag, telemetry } = loadConfig({ ...base });
    expect(model.apiKey).toBe("sk-test");
    expect(tools.webSearch.maxResults).toBe(5);
    expect(tools.webSearch.tavilyApiKey).toBeUndefined();
    expect(security.redactPii).toBe(true);
    expect(security.approvalsEnabled).toBe(true);
    expect(rag.rerankEnabled).toBe(true);
    expect(telemetry.enabled).toBe(false);
  });

  it("aggregates field issues into one error", () => {
    expect(() => loadConfig({ WEB_SEARCH_MAX_RESULTS: "-3" })).toThrow(
      /Invalid environment configuration[\s\S]*model\.apiKey[\s\S]*tools\.webSearch\.maxResults/,
    );
  });

  it("enforces the chunk-overlap cross-field rule", () => {
    expect(() => loadConfig({ ...base, RAG_CHUNK_TOKENS: "10", RAG_CHUNK_OVERLAP: "20" })).toThrow(
      /RAG_CHUNK_OVERLAP must be smaller than RAG_CHUNK_TOKENS/,
    );
  });

  it("reads every toggle through the one bool convention", () => {
    const { security, rag, telemetry, tools } = loadConfig({
      ...base,
      CHAT_APPROVALS_DISABLED: "1",
      REDACT_PII: "false",
      RAG_RERANK_ENABLED: "off",
      OTEL_ENABLED: "yes",
      TAVILY_API_KEY: "tvly",
    });
    expect(security.approvalsEnabled).toBe(false);
    expect(security.redactPii).toBe(false);
    expect(rag.rerankEnabled).toBe(false);
    expect(telemetry.enabled).toBe(true);
    expect(tools.webSearch.tavilyApiKey).toBe("tvly");
  });

  it("omits telemetry exporter fields when disabled", () => {
    const { telemetry: t } = loadConfig({ ...base });
    expect(t).toMatchObject({ enabled: false, captureContent: true });
    expect("endpoint" in t).toBe(false);
  });
});
