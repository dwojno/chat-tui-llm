import { readFileSync } from "node:fs";
import { join } from "node:path";
import { QdrantClient } from "@qdrant/js-client-rest";
import { OpenAI } from "openai";
import { run } from "@/main";
import { DEFAULT_PROFILE_ID } from "@/store/profile/profile.facade";
import { createMockOpenAI, type MockHandoff, type MockTurn } from "@tests/helpers/mock-openai";
import { weatherStubTool } from "./stub-tool";

const stateDir = process.env.CHAT_CLI_STATE_DIR;
if (!stateDir) throw new Error("CHAT_CLI_STATE_DIR must be set to launch the e2e TUI");

// The SQLite state dir is fresh per test, but the Qdrant collection is keyed by the
// (fixed) default profile id, so it would otherwise carry indexed docs across runs.
// Reset it so every e2e run starts from an empty knowledge base.
await new QdrantClient({ url: process.env.QDRANT_URL ?? "http://localhost:6333" })
  .deleteCollection(`kb_${DEFAULT_PROFILE_ID}`)
  .catch(() => undefined);

function replayChatClient(file: string): OpenAI {
  const raw = JSON.parse(readFileSync(file, "utf8")) as
    | MockTurn[]
    | { turns: MockTurn[]; compressions?: MockHandoff[] };
  const turns = Array.isArray(raw) ? raw : raw.turns;
  const compressions = Array.isArray(raw) ? [] : (raw.compressions ?? []);
  return createMockOpenAI(turns, compressions).client;
}

const dbPath = join(stateDir, "chat.db");
const turnsFile = process.env.E2E_TURNS_FILE;

await (turnsFile
  ? run({
      openai: replayChatClient(turnsFile),
      ragOpenai: new OpenAI(),
      dbPath,
      extraTools: [weatherStubTool],
    })
  : run({ dbPath, extraTools: [weatherStubTool] }));
