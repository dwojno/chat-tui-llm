import { describe, expect, it } from "vitest";
import { redactPII } from "@/platform/utils/redact";

describe("redactPII", () => {
  it("scrubs each PII kind", () => {
    expect(redactPII("reach me at jane.doe@example.com")).toBe("reach me at [REDACTED_EMAIL]");
    expect(redactPII("call 555-123-4567")).toBe("call [REDACTED_PHONE]");
    expect(redactPII("ssn 123-45-6789")).toBe("ssn [REDACTED_SSN]");
    expect(redactPII("card 4111 1111 1111 1111")).toBe("card [REDACTED_CC]");
    expect(redactPII("host 192.168.0.1")).toBe("host [REDACTED_IP]");
    expect(redactPII("key sk-abcdefghijklmnop0123")).toBe("key [REDACTED_KEY]");
    expect(redactPII("aws AKIAIOSFODNN7EXAMPLE")).toBe("aws [REDACTED_KEY]");
    expect(redactPII("token eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0NQ.dBjftJeZ4CVP")).toBe(
      "token [REDACTED_KEY]",
    );
  });

  it("redacts several values in one string", () => {
    const out = redactPII("email a@b.com or call (555) 123 4567");
    expect(out).toContain("[REDACTED_EMAIL]");
    expect(out).toContain("[REDACTED_PHONE]");
  });

  it("leaves a non-card long number untouched (fails Luhn)", () => {
    expect(redactPII("order 1234567890123456")).toBe("order 1234567890123456");
  });

  it("leaves ordinary prose untouched", () => {
    const text = "Meet me at 5pm in room 12 to review the Q3 plan.";
    expect(redactPII(text)).toBe(text);
  });

  it("redacts every occurrence across a large chunk, not just the first", () => {
    const block =
      "Jane — jane.doe@example.com, 555-123-4567, ssn 123-45-6789.\n" +
      "John — john.roe@example.org, 555-987-6543, key sk-abcdefghijklmnop0123.\n" +
      "Card 4111 1111 1111 1111 on host 192.168.0.1.\n";
    const chunk = block.repeat(50);

    const out = redactPII(chunk);

    for (const raw of [
      "jane.doe@example.com",
      "john.roe@example.org",
      "555-123-4567",
      "123-45-6789",
      "sk-abcdefghijklmnop0123",
      "4111 1111 1111 1111",
      "192.168.0.1",
    ]) {
      expect(out).not.toContain(raw);
    }

    const count = (token: string) => (out.match(new RegExp(token, "g")) ?? []).length;
    expect(count("\\[REDACTED_EMAIL\\]")).toBe(100);
    expect(count("\\[REDACTED_PHONE\\]")).toBe(100);
    expect(count("\\[REDACTED_SSN\\]")).toBe(50);
    expect(count("\\[REDACTED_KEY\\]")).toBe(50);
    expect(count("\\[REDACTED_CC\\]")).toBe(50);
    expect(count("\\[REDACTED_IP\\]")).toBe(50);
  });
});

describe("known limitation: regex redaction misses encoded PII", () => {
  // These document the ceiling of a regex scrubber — the approval gate and
  // not persisting to third parties are the real backstops, not this function.
  it("does not catch hex-encoded PII", () => {
    const hexSsn = "3132332d34352d36373839";
    expect(redactPII(hexSsn)).toBe(hexSsn);
  });

  it("does not catch base64-encoded PII", () => {
    const b64Email = "amFuZUBleGFtcGxlLmNvbQ==";
    expect(redactPII(b64Email)).toBe(b64Email);
  });

  it("does not catch an email broken up with spaces", () => {
    const spaced = "j a n e @ e x a m p l e . c o m";
    expect(redactPII(spaced)).toBe(spaced);
  });

  it("does not catch an email split by a zero-width space", () => {
    const split = "jane@exam​ple.com";
    expect(redactPII(split)).toBe(split);
  });
});

describe("robustness: adversarial input does not hang or crash", () => {
  it("returns promptly on a huge digit run (no catastrophic backtracking)", () => {
    const out = redactPII("1".repeat(100_000));
    expect(typeof out).toBe("string");
  });

  it("returns promptly on a long local-part with no @ (no ReDoS)", () => {
    const out = redactPII(`${"a".repeat(100_000)}!`);
    expect(out).toBe(`${"a".repeat(100_000)}!`);
  });
});
