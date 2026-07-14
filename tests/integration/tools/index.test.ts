import { describe, expect, it } from "vitest";
import { createAgentTools } from "../../../src/tools";
import { DELEGATE_TASK_NAME } from "../../../src/tools/delegation/delegate-task";
import { DELEGATE_TASKS_NAME } from "../../../src/tools/delegation/delegate-tasks";
import { WEATHER_TOOL_NAME } from "../../../src/tools/weather";
import { WEB_SEARCH_TOOL_NAME } from "../../../src/tools/web-search";
import { createMemoryStore } from "../../helpers/mock-openai";

describe("createAgentTools", () => {
  it("gives the main agent delegate + disk tools but NOT the knowledge-base tools", async () => {
    const store = await createMemoryStore();
    const { tools } = createAgentTools(store);
    const names = tools.map((t) => t.name);
    expect(names).toContain(WEATHER_TOOL_NAME);
    expect(names).toContain(DELEGATE_TASK_NAME);
    expect(names).toContain(DELEGATE_TASKS_NAME);
    expect(names).toEqual(expect.arrayContaining(["read_file", "write_file", "edit_file"]));
    // KB tools are fork-only — the main agent reaches them via delegation.
    expect(names).not.toContain("search_knowledge_base");
    expect(names).not.toContain("read_source");
  });

  it("gives the general fork web_search + weather but never delegate tools (no recursion)", async () => {
    const store = await createMemoryStore();
    const { forkProfiles } = createAgentTools(store);
    const names = forkProfiles.general.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining([WEATHER_TOOL_NAME, WEB_SEARCH_TOOL_NAME]));
    expect(names).not.toContain(DELEGATE_TASK_NAME);
    expect(names).not.toContain(DELEGATE_TASKS_NAME);
  });

  it("gives the rag_research fork the knowledge-base tools only", async () => {
    const store = await createMemoryStore();
    const { forkProfiles } = createAgentTools(store);
    const names = forkProfiles.rag_research.tools.map((t) => t.name);
    expect(names).toEqual(["search_knowledge_base", "list_files", "grep_files", "read_source"]);
    expect(names).not.toContain(WEB_SEARCH_TOOL_NAME);
    expect(names).not.toContain(DELEGATE_TASK_NAME);
  });
});
