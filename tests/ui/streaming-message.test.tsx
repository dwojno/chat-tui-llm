import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { StreamingMessage } from "@/ui/components/streaming-message";

// eslint-disable-next-line no-control-regex
const strip = (frame: string | undefined): string => (frame ?? "").replace(/\[[0-9;]*m/g, "");

describe("StreamingMessage scratchpad panel", () => {
  it("shows the section name and its todo content while working", () => {
    const { lastFrame } = render(
      <StreamingMessage
        steps={[]}
        content=""
        scratchpad={[{ section: "todo", content: "- [ ] check weather\n- [x] greet user" }]}
      />,
    );
    const frame = strip(lastFrame());
    expect(frame).toContain("todo");
    expect(frame).toContain("☐ check weather");
    expect(frame).toContain("☑ greet user");
    expect(frame).not.toContain("•");
  });

  it("replaces the panel in place when the scratchpad updates", () => {
    const { rerender, lastFrame } = render(
      <StreamingMessage
        steps={[]}
        content=""
        scratchpad={[{ section: "todo", content: "- [ ] step one" }]}
      />,
    );
    expect(strip(lastFrame())).toContain("step one");

    rerender(
      <StreamingMessage
        steps={[]}
        content=""
        scratchpad={[{ section: "todo", content: "- [x] step two" }]}
      />,
    );
    const frame = strip(lastFrame());
    expect(frame).toContain("step two");
    expect(frame).not.toContain("step one");
  });

  it("renders nothing extra when there is no scratchpad", () => {
    const { lastFrame } = render(<StreamingMessage steps={[]} content="hello" />);
    expect(strip(lastFrame())).not.toContain("todo");
  });
});
