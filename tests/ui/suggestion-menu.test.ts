import { describe, expect, it } from "vitest";
import { isExactSlashCommand } from "../../src/ui/components/suggestion-menu";

describe("isExactSlashCommand", () => {
  it("matches complete slash commands", () => {
    expect(isExactSlashCommand("/conversation")).toBe(true);
    expect(isExactSlashCommand("/profile")).toBe(true);
    expect(isExactSlashCommand("/sources")).toBe(true);
  });

  it("rejects partial or unknown input", () => {
    expect(isExactSlashCommand("/conv")).toBe(false);
    expect(isExactSlashCommand("/conversation ")).toBe(false);
    expect(isExactSlashCommand("hello")).toBe(false);
  });
});
