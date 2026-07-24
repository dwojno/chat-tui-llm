import assert from "node:assert";
import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { OpenAI } from "openai";
import { ensureInfra } from "./infra";
import { EVAL_MAX_RETRIES } from "./client";
import { Agent } from "@chat/agent/agent";
import { EventBus } from "@chat/agent/events/bus";
import { SYSTEM_INSTRUCTIONS } from "@/app/prompts";
import { EVAL_PROBE_MODEL, MAX_TOOL_STEPS, MAX_CONSECUTIVE_ERRORS } from "@/app/config";
import { DEFAULT_TURN_OPTIONS, type TurnOptions } from "@chat/agent/conversation/options";
import { runAgentLoop } from "@/app/runner/runner";
import { eventsToInputItems } from "@/app/runner/thread/convert";
import { createAgentTools } from "@/app/tools";
import { createRagTools } from "@/app/tools/rag";
import { createRagDeps, LocalStore, type IndexResult, type Store } from "@/store";
import { loadConfig } from "@/platform/config";
import { Model } from "@/platform/model";
import { traceToolExecution } from "@/platform/telemetry";

const KB_TOOLS = new Set(["search_knowledge_base", "read_source", "grep_files"]);

const CITATION_DIRECTIVE = `
<grounding>
You are being evaluated on grounded, cited answers. For every reply:
- Answer ONLY from the knowledge-base tools (search_knowledge_base, grep_files,
  read_source). Never use outside knowledge.
- If the knowledge base does not contain the answer, say you do not have enough
  information to answer — do not guess.
- End the reply with a final line naming the source files you actually used,
  exactly in this form (use the file paths the tools returned):
    Sources: path/one.md, path/two.md
  If you used no sources, write "Sources: none".
</grounding>`;

export interface RagResult {
  query: string;
  answer: string;
  retrievedContext: string[];
  retrievedSources: string[];
  citedSources: string[];
  retrievedHitCount: number;
  toolCalls: { name: string; arguments: string }[];
}

export interface RagHarness {
  reset(): Promise<void>;
  ingest(select?: string[]): Promise<IndexResult[]>;
  setup(select?: string[]): Promise<IndexResult[]>;
  myRagPipeline(query: string): Promise<RagResult>;
  profileId(): Promise<string>;
}

export interface RagHarnessOptions {
  suiteId: string;
  corpusDir: string;
  openai?: OpenAI;
  instructions?: string;
}

const CHAT_MODEL = process.env.RAG_CHAT_MODEL ?? EVAL_PROBE_MODEL;

interface Wired {
  store: Store;
  agent: Agent;
  profileId: string;
}

export function createRagHarness(opts: RagHarnessOptions): RagHarness {
  const openai = opts.openai ?? new OpenAI({ maxRetries: EVAL_MAX_RETRIES });
  let wiredPromise: Promise<Wired> | undefined;

  const wire = (): Promise<Wired> =>
    (wiredPromise ??= (async () => {
      await ensureInfra();
      const { rag } = loadConfig(process.env);
      const store = await LocalStore.open(":memory:", {
        rag: createRagDeps(openai, rag),
      });
      const profile = await store.profile.create(`eval-${opts.suiteId}`);
      await store.profile.switchTo(profile.id);
      const { forkProfiles } = createAgentTools(store);
      const agent = new Agent({
        model: Model.fromOpenAI(openai),
        temperature: 0.7,
        tools: createRagTools(store),
        forkProfiles,
        cacheKey: `eval-${opts.suiteId}`,
        instructions: opts.instructions ?? `${SYSTEM_INSTRUCTIONS}\n${CITATION_DIRECTIVE}`,
        traceToolExecution,
      });
      return { store, agent, profileId: store.profileId };
    })());

  async function reset(): Promise<void> {
    const { store, profileId } = await wire();
    await store.sources.reset(profileId);
  }

  async function ingest(select?: string[]): Promise<IndexResult[]> {
    const { store, profileId } = await wire();
    const files = await resolveCorpusFiles(opts.corpusDir, select);
    assert(
      files.length > 0,
      select?.length
        ? `No corpus files in ${opts.corpusDir} match: ${select.join(", ")}`
        : `No corpus files found in ${opts.corpusDir}`,
    );

    const results: IndexResult[] = [];
    for (const path of files) {
      results.push(await drainToResult(store, profileId, path));
    }
    return results;
  }

  async function setup(select?: string[]): Promise<IndexResult[]> {
    await reset();
    return ingest(select);
  }

  async function myRagPipeline(query: string): Promise<RagResult> {
    const { agent } = await wire();
    const options: TurnOptions = {
      ...DEFAULT_TURN_OPTIONS,
      stream: false,
      model: CHAT_MODEL,
    };

    const callNames = new Map<string, string>();
    const retrievedContext: string[] = [];
    const sources = new Set<string>();
    const toolCalls: { name: string; arguments: string }[] = [];
    let hitCount = 0;

    const { answer, events } = await runAgentLoop({
      agent,
      events: [{ type: "user_message", content: query }],
      options,
      context: { memories: [] },
      bus: new EventBus(),
      maxToolSteps: MAX_TOOL_STEPS,
      maxConsecutiveErrors: MAX_CONSECUTIVE_ERRORS,
    });

    const items = eventsToInputItems(events);
    for (const item of items) {
      if (item.type === "function_call") {
        callNames.set(item.call_id, item.name);
        toolCalls.push({ name: item.name, arguments: item.arguments });
        if (KB_TOOLS.has(item.name)) {
          for (const path of pathsFromArgs(item.arguments)) sources.add(basename(path));
        }
      } else if (item.type === "function_call_output") {
        const name = callNames.get(item.call_id);
        if (name && KB_TOOLS.has(name)) {
          const output =
            typeof item.output === "string" ? item.output : JSON.stringify(item.output);
          retrievedContext.push(output);
          const paths = pathsFromOutput(output);
          hitCount += paths.length;
          for (const path of paths) sources.add(basename(path));
        }
      }
    }

    return {
      query,
      answer,
      retrievedContext,
      retrievedSources: [...sources],
      citedSources: citedSourcesFrom(answer),
      retrievedHitCount: hitCount,
      toolCalls,
    };
  }

  return {
    reset,
    ingest,
    setup,
    myRagPipeline,
    profileId: async () => (await wire()).profileId,
  };
}

const OUTPUT_PATH = /(?:^|\n)\s*([^\s:]+\.[A-Za-z0-9]+):\d/g;

function pathsFromArgs(argsJson: string): string[] {
  try {
    const parsed = JSON.parse(argsJson) as { path?: unknown; paths?: unknown };
    const out: string[] = [];
    if (typeof parsed.path === "string") out.push(parsed.path);
    if (Array.isArray(parsed.paths)) {
      for (const path of parsed.paths) if (typeof path === "string") out.push(path);
    }
    return out;
  } catch {
    return [];
  }
}

function pathsFromOutput(text: string): string[] {
  return [...text.matchAll(OUTPUT_PATH)]
    .map((match) => match[1])
    .filter((path): path is string => path !== undefined);
}

function citedSourcesFrom(answer: string): string[] {
  const lines = [...answer.matchAll(/sources?\s*:\s*([^\n]+)/gi)];
  const segment = lines.at(-1)?.[1];
  if (!segment || /^\s*none\b/i.test(segment)) return [];
  const tokens = segment.match(/[\w./-]+\.[A-Za-z0-9]+/g) ?? [];
  return [...new Set(tokens.map((token) => basename(token)))];
}

async function resolveCorpusFiles(corpusDir: string, select?: string[]): Promise<string[]> {
  const entries = await readdir(corpusDir, { withFileTypes: true });
  const all = entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
    .map((entry) => join(corpusDir, entry.name));
  if (!select?.length) return all;
  const wanted = new Set(select);
  return all.filter((path) => wanted.has(path) || wanted.has(basename(path)));
}

async function drainToResult(store: Store, profileId: string, path: string): Promise<IndexResult> {
  const gen = store.sources.add(profileId, path);
  let next = await gen.next();
  while (!next.done) next = await gen.next();
  return next.value;
}
