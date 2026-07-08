import { afterEach, describe, expect, it, vi } from "vitest";
import { weatherTool } from "../../../src/agent/tools/weather";
import { drainToReturn } from "../../helpers/mock-openai";

afterEach(() => {
  vi.useRealTimers();
});

describe("weatherTool", () => {
  it("returns a sunny report for the city (after its simulated latency)", async () => {
    vi.useFakeTimers();
    const pending = drainToReturn(weatherTool.execute({ city: "Paris" }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toBe("The weather in Paris is sunny");
  });

  it("summarizes a call to the city name", () => {
    expect(weatherTool.summarize?.({ city: "Tokyo" })).toBe("Tokyo");
  });

  it("exposes its display label and name", () => {
    expect(weatherTool.name).toBe("get_weather_data");
    expect(weatherTool.label).toBe("Fetching weather data");
  });
});
