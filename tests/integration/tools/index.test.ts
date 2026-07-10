import { describe, expect, it } from "vitest";
import { createAgentTools } from "../../../src/integration/tools";
import { DELEGATE_TASK_NAME } from "../../../src/integration/tools/delegate-task";
import { DELEGATE_TASKS_NAME } from "../../../src/integration/tools/delegate-tasks";
import { WEATHER_TOOL_NAME } from "../../../src/integration/tools/weather";
import { WEB_SEARCH_TOOL_NAME } from "../../../src/integration/tools/web-search";
import { createMemoryStore } from "../../helpers/mock-openai";

describe("createAgentTools", () => {
  it("composes weather + delegate + RAG tools for the main agent", async () => {
    const store = await createMemoryStore();
    const { tools } = createAgentTools(store);
    const names = tools.map((t) => t.name);
    expect(names).toContain(WEATHER_TOOL_NAME);
    expect(names).toContain(DELEGATE_TASK_NAME);
    expect(names).toContain(DELEGATE_TASKS_NAME);
    expect(names).toEqual(
      expect.arrayContaining(["search_knowledge_base", "list_files", "grep_files", "read_file"]),
    );
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
    expect(names).toEqual(["search_knowledge_base", "list_files", "grep_files", "read_file"]);
    expect(names).not.toContain(WEB_SEARCH_TOOL_NAME);
    expect(names).not.toContain(DELEGATE_TASK_NAME);
  });
});
