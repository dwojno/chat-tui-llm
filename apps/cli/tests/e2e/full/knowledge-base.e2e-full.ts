import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { spawnTui, type Tui } from "./driver";

const newStateDir = (): string => mkdtempSync(join(tmpdir(), "tui-live-"));
const HANDBOOK = "apps/cli/tests/fixtures/rag-corpus/handbook.md";
const STEP = { timeout: 180_000 };

describe("TUI e2e (LIVE): grounded support conversation over the Nimbus handbook", () => {
  let tui: Tui;

  afterEach(async () => {
    await tui?.close();
  });

  it(
    "learns a doc, answers grounded follow-ups in context, and refuses ungrounded facts",
    { timeout: 600_000 },
    async () => {
      tui = spawnTui({ stateDir: newStateDir() });
      await tui.waitFor("Welcome to Chat CLI");

      // 1. Ingest only the handbook (NOT the FAQ) into real Qdrant.
      expect(await tui.ask(`/learn @${HANDBOOK} `, /Indexed \d+ source/i, STEP)).toMatch(
        /Indexed \d+ source/i,
      );

      // 2. A question that must retrieve the real value from the KB.
      expect(
        await tui.ask("What is the default storage quota per project?", /50\s*GB/i, STEP),
      ).toMatch(/50\s*GB/i);

      // 3. Follow-up whose subject ("it") is only resolvable from prior turn context.
      expect(await tui.ask("How can I increase it?", /support/i, STEP)).toMatch(/support/i);

      // 4. Follow-up needing another grounded fact from the same doc.
      const errCode = await tui.ask(
        "What error code is returned when a project goes over that limit?",
        /NIMBUS_QUOTA_EXCEEDED/,
        STEP,
      );
      expect(errCode).toMatch(/NIMBUS_QUOTA_EXCEEDED/);

      // 5. Hallucination guard: billing lives in the FAQ, which was never indexed.
      //    Wait for the turn to finish (wording of a refusal varies run to run), then
      //    assert the agent did NOT invent the FAQ's "first business day" answer and
      //    that it actually declined rather than fabricating a date.
      const billing = await tui.askSettled("On which day of the month are invoices issued?");
      expect(billing).not.toMatch(/first business day/i);
      expect(billing).toMatch(
        /does(n.t| not) (specify|mention|have|include)|not specif|could(n.t| not) find|would(n.t| not) infer|do(n.t| not) (have|see)|no( documented| relevant)? (information|data)|not (found|available|documented)|isn.t (in|available|documented)|unable|can(n.t| not) find/i,
      );
    },
  );
});
