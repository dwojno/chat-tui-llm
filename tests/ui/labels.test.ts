import { describe, expect, it } from "vitest";
import { toolStepLabel } from "../../src/ui/labels";

describe("toolStepLabel", () => {
  it("maps known tool names to their friendly labels (main + fork tools)", () => {
    expect(toolStepLabel("get_weather_data")).toBe("Fetching weather data");
    expect(toolStepLabel("web_search")).toBe("Searching the web");
    expect(toolStepLabel("delegate_task")).toBe("Delegating to a sub-agent");
  });

  it("falls back to a readable default for unknown tools", () => {
    expect(toolStepLabel("mystery_tool")).toBe("Running mystery_tool");
  });
});
