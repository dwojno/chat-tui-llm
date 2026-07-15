import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import { PickerModal } from "@/ui/components/picker-modal";

// eslint-disable-next-line no-control-regex
const strip = (frame: string | undefined): string =>
  (frame ?? "").replace(/\[[0-9;]*m/g, "");

const LONG_LABEL = "Compare Nirvana with Pearl Jam discographies";

describe("PickerModal", () => {
  it("renders long option labels in full in plain mode", () => {
    const { lastFrame } = render(
      <PickerModal
        title="What are you comparing?"
        items={[{ id: LONG_LABEL, label: LONG_LABEL }]}
        createLabel="Type my own answer"
        selected={0}
        plain
      />,
    );

    expect(strip(lastFrame())).toContain(LONG_LABEL);
  });

  it("truncates long labels in the default columnar mode", () => {
    const { lastFrame } = render(
      <PickerModal
        title="Pick a conversation"
        items={[{ id: LONG_LABEL, label: LONG_LABEL }]}
        createLabel="Create new"
        selected={0}
      />,
    );

    expect(strip(lastFrame())).not.toContain(LONG_LABEL);
  });
});
