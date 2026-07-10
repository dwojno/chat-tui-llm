import assert from "node:assert";
import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { OpenAI } from "openai";
import { ensureInfra } from "./infra";
import { AgentService } from "../../src/agent/agent";
import { SYSTEM_INSTRUCTIONS } from "../../src/agent/prompts";
import { MODEL } from "../../src/agent/config";
import { DEFAULT_TURN_OPTIONS, type TurnOptions } from "../../src/agent/conversation/options";
import { createAgentTools } from "../../src/integration/tools";
import {
  createRagDeps,
  loadRagConfig,
  LocalStore,
  type IndexResult,
  type Store,
} from "../../src/store";

/**
 * A real, non-mocked RAG pipeline wired for evaluation as a true end-to-end
 * test: it runs the app's actual `AgentService` loop (from `src/agent/agent.ts`)
 * with the real store-backed RAG tools injected exactly as `main.ts` composes
 * them. The agent itself decides to call `search_knowledge_base` (hybrid
 * dense+sparse Qdrant search, RRF-fused) over the real index, reads back real
 * source content, and answers. Nothing here is stubbed.
 *
 * `retrievedContext` is captured from the agent's *actual* knowledge-base tool
 * outputs during the run — the real passages the model grounded on — so the
 * eval scores what the system genuinely retrieved and generated.
 *
 * Each suite gets its own isolated profile (`eval-<suiteId>` → its own Qdrant
 * collection + MinIO bucket) so suites reset and run in parallel without
 * colliding, and never touch the user's real profiles. SQLite bookkeeping runs
 * in-memory, so evals leave no trace in `.chat-state/chat.db`.
 */

/** Knowledge-base tools whose output counts as "retrieved context". */
const KB_TOOLS = new Set(["search_knowledge_base", "read_file", "grep_files"]);

/**
 * Grounding directive appended to the real system prompt *for the eval only*
 * (the harness builds its own AgentService, so production behaviour is
 * untouched). It forces the agent to answer strictly from the knowledge base
 * and to end every reply with a machine-parseable citation line, so we can
 * score both what it retrieved and what it claims it used.
 */
const CITATION_DIRECTIVE = `
<grounding>
You are being evaluated on grounded, cited answers. For every reply:
- Answer ONLY from the knowledge-base tools (search_knowledge_base, grep_files,
  read_file). Never use outside knowledge.
- If the knowledge base does not contain the answer, say you do not have enough
  information to answer — do not guess.
- End the reply with a final line naming the source files you actually used,
  exactly in this form (use the file paths the tools returned):
    Sources: path/one.md, path/two.md
  If you used no sources, write "Sources: none".
</grounding>`;

/** What `myRagPipeline` returns to the eval (the contract the suite scores). */
export interface RagResult {
  query: string;
  answer: string;
  /** The real text the agent retrieved from the KB tools during the run. */
  retrievedContext: string[];
  /**
   * Basenames of the source files the agent actually pulled context from
   * (parsed from the KB tool calls + outputs). Deduped. The ground truth of
   * what retrieval surfaced — scored for recall against a case's gold ids.
   */
  retrievedSources: string[];
  /**
   * Basenames the agent *claimed* it used, parsed from the trailing `Sources:`
   * citation line its answer must end with. Compared against `gold` (did it
   * cite the right files?) and against `retrievedSources` (grounding: every
   * cited file must have actually been retrieved — no fabricated citations).
   */
  citedSources: string[];
  /**
   * Total number of hit blocks the KB tools returned across the run (search +
   * grep hits, counted from the `path:line` prefixes). A diagnostic for
   * over-fetch *volume* — file-basename gold can't score chunk count, but this
   * is the clearest "receives all the things" signal.
   */
  retrievedHitCount: number;
  /** What the agent actually did this turn — for trace inspection. */
  toolCalls: { name: string; arguments: string }[];
}

export interface RagHarness {
  /** Wipe the suite's Qdrant collection + MinIO bucket (clean slate). */
  reset(): Promise<void>;
  /**
   * Ingest corpus files. With no `select`, ingests every file in `corpusDir`;
   * pass a list of basenames or repo-relative paths to ingest only those. The
   * services are auto-prepared (Qdrant + MinIO started if needed) on first use.
   * Idempotent: re-running re-indexes each file in place (stale chunks dropped,
   * deterministic point ids) — no duplicates.
   */
  ingest(select?: string[]): Promise<IndexResult[]>;
  /**
   * `reset()` then `ingest(select)` — a guaranteed-fresh index. This is the
   * one call a suite needs to prepare its bucket + collection and load a
   * (possibly partial) corpus programmatically.
   */
  setup(select?: string[]): Promise<IndexResult[]>;
  /** Run the real agent for one query and capture its answer + retrieved text. */
  myRagPipeline(query: string): Promise<RagResult>;
  /** The isolated profile id (collection `kb_<id>`), available after first use. */
  profileId(): Promise<string>;
}

export interface RagHarnessOptions {
  /** Unique per suite — drives the profile, Qdrant collection + MinIO bucket. */
  suiteId: string;
  /** Folder of source files to index (repo-relative). */
  corpusDir: string;
  /** Shared OpenAI client (falls back to a new one). */
  openai?: OpenAI;
}

const CHAT_MODEL = process.env.RAG_CHAT_MODEL ?? MODEL;

interface Wired {
  store: Store;
  agent: AgentService;
  profileId: string;
}

export function createRagHarness(opts: RagHarnessOptions): RagHarness {
  const openai = opts.openai ?? new OpenAI();
  let wiredPromise: Promise<Wired> | undefined;

  const wire = (): Promise<Wired> =>
    (wiredPromise ??= (async () => {
      // Prepare the services (start Qdrant + MinIO if they aren't up) before we
      // touch the store, so a suite is self-sufficient without evalite's
      // setupFiles. Memoized + never throws — at most one health check.
      await ensureInfra();
      const store = await LocalStore.open(":memory:", {
        rag: createRagDeps(openai, loadRagConfig()),
      });
      // Isolate this suite in its own profile so the RAG tools (which target
      // `store.profileId`) hit a dedicated collection + bucket.
      const profile = await store.profile.create(`eval-${opts.suiteId}`);
      await store.profile.switchTo(profile.id);
      const { tools, forkTools } = createAgentTools(store);
      const agent = new AgentService(openai, {
        tools,
        forkTools,
        cacheKey: `eval-${opts.suiteId}`,
        instructions: `${SYSTEM_INSTRUCTIONS}\n${CITATION_DIRECTIVE}`,
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
      // add() converts → uploads → chunks → embeds → indexes. It never throws
      // on a bad file; it returns { status: "error" } so one odd format can't
      // sink the whole ingest.
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
    let answer = "";

    for await (const event of agent.run([{ role: "user", content: query }], options)) {
      if (event.type === "answer") {
        answer = event.content;
      } else if (event.type === "message") {
        const item = event.item;
        if (item.type === "function_call") {
          callNames.set(item.call_id, item.name);
          toolCalls.push({ name: item.name, arguments: item.arguments });
          // read_file / grep_files name their target(s) in the call arguments.
          if (KB_TOOLS.has(item.name)) {
            for (const path of pathsFromArgs(item.arguments)) sources.add(basename(path));
          }
        } else if (item.type === "function_call_output") {
          const name = callNames.get(item.call_id);
          if (name && KB_TOOLS.has(name)) {
            const output =
              typeof item.output === "string" ? item.output : JSON.stringify(item.output);
            retrievedContext.push(output);
            // search / grep prefix each result line with its `path:line…`.
            const paths = pathsFromOutput(output);
            hitCount += paths.length;
            for (const path of paths) sources.add(basename(path));
          }
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

/** A `path:line…` token at the start of a tool-output line (search/grep hits). */
const OUTPUT_PATH = /(?:^|\n)\s*([^\s:]+\.[A-Za-z0-9]+):\d/g;

/** File paths named in a KB tool call's arguments (`read_file`/`grep_files`). */
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

/** File paths that appear as line prefixes in a search/grep tool output. */
function pathsFromOutput(text: string): string[] {
  return [...text.matchAll(OUTPUT_PATH)]
    .map((match) => match[1])
    .filter((path): path is string => path !== undefined);
}

/**
 * Basenames from the answer's trailing `Sources:` citation line (the grounding
 * directive requires one). Returns [] for "Sources: none" or a missing line.
 */
function citedSourcesFrom(answer: string): string[] {
  const lines = [...answer.matchAll(/sources?\s*:\s*([^\n]+)/gi)];
  const segment = lines.at(-1)?.[1];
  if (!segment || /^\s*none\b/i.test(segment)) return [];
  const tokens = segment.match(/[\w./-]+\.[A-Za-z0-9]+/g) ?? [];
  return [...new Set(tokens.map((token) => basename(token)))];
}

/**
 * List the corpus files to ingest. With no `select`, returns every non-hidden
 * file in `corpusDir`; otherwise keeps only those whose basename or full
 * repo-relative path is named in `select`, so a suite can ingest a subset.
 */
async function resolveCorpusFiles(corpusDir: string, select?: string[]): Promise<string[]> {
  const entries = await readdir(corpusDir, { withFileTypes: true });
  const all = entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith("."))
    .map((entry) => join(corpusDir, entry.name));
  if (!select?.length) return all;
  const wanted = new Set(select);
  return all.filter((path) => wanted.has(path) || wanted.has(basename(path)));
}

/**
 * `store.sources.add` is an async generator whose *return* value carries the
 * IndexResult (its yields are progress events for the interactive UI). Drive it
 * to completion and hand back that return.
 */
async function drainToResult(store: Store, profileId: string, path: string): Promise<IndexResult> {
  const gen = store.sources.add(profileId, path);
  let next = await gen.next();
  while (!next.done) next = await gen.next();
  return next.value;
}
