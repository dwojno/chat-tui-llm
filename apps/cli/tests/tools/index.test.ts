import assert from "node:assert";
import { describe, expect, it } from "vitest";
import { createAgentTools } from "@chat/tools";
import { DELEGATE_TASK_NAME } from "@chat/tools/delegation/delegate-task";
import { DELEGATE_TASKS_NAME } from "@chat/tools/delegation/delegate-tasks";
import { WEB_SEARCH_TOOL_NAME } from "@chat/tools/web-search";
import type { Store } from "@/backend";
import { createMemoryStore } from "@tests/helpers/mock-openai";

const createTools = (store: Store) =>
  createAgentTools({
    store,
    forkModel: "test-fork-model",
    handoffModel: "test-handoff-model",
    webSearch: { maxResults: 5 },
  });

describe("createAgentTools", () => {
  it("gives the main agent delegate + disk tools but NOT the knowledge-base tools", async () => {
    const store = await createMemoryStore();
    const { tools } = createTools(store);
    const names = tools.map((t) => t.name);
    expect(names).toContain(DELEGATE_TASK_NAME);
    expect(names).toContain(DELEGATE_TASKS_NAME);
    expect(names).toEqual(expect.arrayContaining(["read_file", "write_file", "edit_file"]));

    expect(names).not.toContain("search_knowledge_base");
    expect(names).not.toContain("read_source");
  });

  it("does not expose request_approval, so the deterministic gate is the only approval prompt", async () => {
    const store = await createMemoryStore();
    const { tools } = createTools(store);
    const names = tools.map((t) => t.name);

    expect(names).not.toContain("request_approval");

    const writeFile = tools.find((t) => t.name === "write_file");
    assert(writeFile !== undefined);
    const need = writeFile.approvalPolicy?.({ path: "notes.txt", content: "x" });
    expect(need).toMatchObject({ required: true });
  });

  it("gives the general fork web_search but never delegate tools (no recursion)", async () => {
    const store = await createMemoryStore();
    const { forkProfiles } = createTools(store);
    assert(forkProfiles.general !== undefined);
    const names = forkProfiles.general.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining([WEB_SEARCH_TOOL_NAME]));
    expect(names).not.toContain(DELEGATE_TASK_NAME);
    expect(names).not.toContain(DELEGATE_TASKS_NAME);
  });

  it("gives the rag_research fork the knowledge-base tools only", async () => {
    const store = await createMemoryStore();
    const { forkProfiles } = createTools(store);
    assert(forkProfiles.rag_research !== undefined);
    const names = forkProfiles.rag_research.tools.map((t) => t.name);
    expect(names).toEqual(["search_knowledge_base", "list_files", "grep_files", "read_source"]);
    expect(names).not.toContain(WEB_SEARCH_TOOL_NAME);
    expect(names).not.toContain(DELEGATE_TASK_NAME);
  });
});
