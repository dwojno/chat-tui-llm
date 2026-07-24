# Persistence: SQLite + Drizzle

chat-cli persists durable state behind a top-level [`Store`](../apps/cli/src/backend/index.ts)
facade. The store composes namespaced domain facades —
[`profile`](../apps/cli/src/backend/profile/) (settings), [`conversation`](../apps/cli/src/backend/conversation/index.ts) (transcript, summaries,
usage), [`memory`](../apps/cli/src/backend/memory/) (pinned memories), and
[`sources`](../apps/cli/src/backend/sources/index.ts) (learned file paths). SQLite is the
current backend; its schema is documented below.

## Store (top-level facade)

[`Session`](../apps/cli/src/session/session.ts) and the commands depend on `Store`
and its namespaces, never on SQLite directly:

```ts
const store = await LocalStore.open(DB_PATH);
const session = await Session.create(agent, openai, store, KEEP_LAST_TURNS, bus);

await store.conversation.createItems(store.conversationId, items);
await store.memory.create(store.profileId, "likes tea");
await store.sources.create(store.profileId, "src/a.ts");

const profiles = await store.profile.query().execute();
const conversations = await store.conversation
  .query()
  .forProfile(store.profileId)
  .orderByLastActivity()
  .execute();
const memories = await store.memory.query().forProfile(store.profileId).execute();
const profile = await store.profile.query().byId(store.profileId).executeAndTakeFirst();
const conversation = await store.conversation
  .query()
  .byId(store.conversationId)
  .executeAndTakeFirst();
```

| Type                                                                                | Role                                              |
| ----------------------------------------------------------------------------------- | ------------------------------------------------- |
| [`Store`](../apps/cli/src/backend/index.ts)                                         | Top-level facade — `profileId` + `conversationId` |
| [`LocalStore`](../apps/cli/src/backend/store.ts)                                    | SQLite bundle (`open(path)` or `":memory:"`)      |
| [`ProfileFacade`](../apps/cli/src/backend/profile/profile.facade.ts)                | Profile settings (model)                          |
| [`ConversationFacade`](../apps/cli/src/backend/conversation/conversation.facade.ts) | Transcript, summaries, token usage                |
| [`MemoryFacade`](../apps/cli/src/backend/memory/memory.facade.ts)                   | Pinned memories (profile-scoped)                  |
| [`SourcesFacade`](../apps/cli/src/backend/sources/source.facade.ts)                 | Learned source paths (profile-scoped)             |

Each domain exposes a facade and a repository holding its SQL.
[`apps/cli/src/backend/db/`](../apps/cli/src/backend/db/) holds schema, migrations,
and connection; the composition root in [`store.ts`](../apps/cli/src/backend/store.ts) wires
facades with constructor injection. Tests run against the same SQLite code via
`LocalStore.open(":memory:")`, so they exercise the real SQL — there is no
separate in-memory stand-in to drift from production behaviour.

### Future backends (not implemented)

A remote or Postgres backend is a new `Store` whose namespaces call `fetch()`
(or another driver) instead of SQL — no `Session` or agent changes:

```ts
class CloudStore implements Store {
  readonly profile: ApiProfileFacade;
  readonly conversation: ApiConversationFacade;
  readonly memory: ApiMemoryFacade;
  readonly sources: ApiSourcesFacade;
}
```

File-blob (S3) and vector-search (Qdrant) namespaces can be added the same way
when those features land.

## Design principles

1. **Never store what SQL can derive** — token totals, turn counts, and the
   naive baseline are computed at read time, never cached in a row.
2. **`conversation_item` is append-only** — no `UPDATE` or `DELETE`, ever. Each
   windowing pass **inserts** a new `kind = 'summary'` segment row; earlier segments
   stay in the log.
3. **Summaries are durable segments, not a scratch buffer** — each summary row covers
   the messages between it and the previous summary. `forModel()` returns _every_
   segment plus the messages after the last one, so evicted turns are always
   represented (never lost) and the view survives a restart.

| Stored (source of truth)              | Derived (SQL / pure fn at read time)            |
| ------------------------------------- | ----------------------------------------------- |
| Per-item token columns on anchor rows | `SUM(input_tokens)`, `SUM(output_tokens)`, etc. |
| `kind = 'user_message'` rows          | turn count                                      |
| All item payloads                     | naive baseline estimate                         |

## On-disk layout

| Path                      | Purpose                                                                  |
| ------------------------- | ------------------------------------------------------------------------ |
| `.chat-state/chat.db`     | SQLite database (WAL mode) — all persisted state                         |
| `.chat-state/active.json` | JSON pointer to the active profile (`{ "profileId": "..." }`)            |
| `.chat-state/sources/`    | Converted-Markdown RAG blobs (when `RAG_BLOB_BACKEND=disk`, the default) |

The whole `.chat-state/` directory is gitignored.

## Read patterns

| Concern          | SQL query                                     | Used for                       |
| ---------------- | --------------------------------------------- | ------------------------------ |
| **Transcript**   | `queryHistory()`                              | UI replay + model window       |
| **Usage totals** | `SUM(...)` over token columns                 | status bar, `/report`          |
| **Memories**     | `memory` table, profile-scoped, `ORDER BY id` | the reducer's `buildMessage()` |

`queryHistory()` is the fluent transcript read API, returning `AgentEvent[]`, in three
modes:

- `.execute()` — the full transcript (summaries excluded), for UI replay.
- `.afterLastSummary()` — the non-summary tail after the last summary row; the windower folds this into a new segment when it overflows `KEEP_LAST_TURNS`.
- `.forModel()` — **every summary segment, then the messages after the last one** (`kind = 'summary' OR id > lastSummaryId`). Summaries are returned as `{ type: 'summary' }` events and rendered `<conversation_summary>` by the reducer; nothing rides outside the event list.

Window size is enforced by summarization (`maintainWindow`), not by capping the read.

```mermaid
flowchart LR
  subgraph persist [conversation_item append-only]
    items["transcript rows"]
    summaries["summary rows (one per windowing pass)"]
  end

  subgraph derived [SQL]
    qHistory["queryHistory() / forModel()"]
    qUsage["getUsageTotals() SUM tokens"]
  end

  items --> qHistory
  items --> qUsage
  summaries --> qHistory
  summaries --> qUsage
```

## ER diagram

```mermaid
erDiagram
  profile ||--o{ conversation : has
  profile ||--o{ memory : owns
  profile ||--o{ source : owns
  conversation ||--o{ conversation_item : has

  profile {
    text id PK
    text name
    text model
    int created_at
  }

  conversation {
    text id PK
    text profile_id FK
    text title
    int created_at
  }

  memory {
    int id PK
    text profile_id FK
    text category
    text text
    int created_at
  }

  source {
    int id PK
    text profile_id FK
    text path
    int created_at
  }

  conversation_item {
    int id PK
    text conversation_id FK
    int turn_index
    text kind
    json payload
    int input_tokens
    int cached_input_tokens
    int output_tokens
    int summarizer_tokens
    int created_at
  }
```

## Tables

### `profile` — settings and memory scope

| Column       | Type               | Notes                                               |
| ------------ | ------------------ | --------------------------------------------------- |
| `id`         | `TEXT PK`          | Slug (`personal` is the default, seeded on migrate) |
| `name`       | `TEXT NOT NULL`    | Display name in the profile picker                  |
| `model`      | `TEXT`             | Optional per-profile model override                 |
| `created_at` | `INTEGER NOT NULL` | Unix ms                                             |

- Temperature is code-defined (a `TEMPERATURE` constant), not a per-profile column.
- Memories and sources belong to a profile, not a conversation — switching
  conversation keeps memory; switching profile does not.
- The active profile id is persisted in `.chat-state/active.json` (not in the DB).

### `conversation` — identifiable, browsable chat threads

| Column       | Type                               | Notes                                            |
| ------------ | ---------------------------------- | ------------------------------------------------ |
| `id`         | `TEXT PK`                          | UUID (`crypto.randomUUID()`)                     |
| `profile_id` | `TEXT NOT NULL FK → profile.id`    | Owning profile                                   |
| `title`      | `TEXT NOT NULL DEFAULT 'New chat'` | Human-readable label for the conversation picker |
| `created_at` | `INTEGER NOT NULL`                 | Unix ms                                          |

- `id` is a UUID, not a sentinel like `'default'`.
- `title` is user-facing and updatable — the conversation row is the one exception to
  the append-only rule (it is metadata, not transcript).
- Last activity is derived, not stored: `MAX(conversation_item.created_at)`.

Browse query:

```sql
SELECT c.id, c.profile_id, c.title, c.created_at,
  (SELECT MAX(ci.created_at) FROM conversation_item ci
   WHERE ci.conversation_id = c.id) AS last_activity_at
FROM conversation c
WHERE c.profile_id = ?
ORDER BY last_activity_at DESC, c.created_at DESC;
```

### `memory` — pinned user notes (`/remember`)

| Column       | Type                              | Notes              |
| ------------ | --------------------------------- | ------------------ |
| `id`         | `INTEGER PK AUTOINCREMENT`        | Order by `id ASC`  |
| `profile_id` | `TEXT NOT NULL FK → profile.id`   |                    |
| `category`   | `TEXT NOT NULL DEFAULT 'general'` | Free-form grouping |
| `text`       | `TEXT NOT NULL`                   | Memory body        |
| `created_at` | `INTEGER NOT NULL`                |                    |

Renamed from `fact` in migration `0003_rename_fact_to_memory`.

### `source` — RAG file registry (`/learn`)

| Column       | Type                            | Notes             |
| ------------ | ------------------------------- | ----------------- |
| `id`         | `INTEGER PK AUTOINCREMENT`      | Order by `id ASC` |
| `profile_id` | `TEXT NOT NULL FK → profile.id` |                   |
| `path`       | `TEXT NOT NULL`                 | cwd-relative      |
| `created_at` | `INTEGER NOT NULL`              |                   |

- Unique: `(profile_id, path)` — dedupes repeat `/learn` of the same file.

### `conversation_item` — append-only transcript + summaries + token usage

| Column                | Type                                 | Notes                                                                       |
| --------------------- | ------------------------------------ | --------------------------------------------------------------------------- |
| `id`                  | `INTEGER PK AUTOINCREMENT`           | Order by `id ASC`                                                           |
| `conversation_id`     | `TEXT NOT NULL FK → conversation.id` |                                                                             |
| `turn_index`          | `INTEGER`                            | `NULL` for `kind = 'summary'`                                               |
| `kind`                | `TEXT NOT NULL`                      | an `AgentEvent` type, or `summary` (free text — no migration to add a kind) |
| `payload`             | `TEXT NOT NULL`                      | JSON — the `AgentEvent` (or `{ content }` for a summary)                    |
| `input_tokens`        | `INTEGER NOT NULL DEFAULT 0`         |                                                                             |
| `cached_input_tokens` | `INTEGER NOT NULL DEFAULT 0`         |                                                                             |
| `output_tokens`       | `INTEGER NOT NULL DEFAULT 0`         |                                                                             |
| `summarizer_tokens`   | `INTEGER NOT NULL DEFAULT 0`         | Non-zero on `kind = 'summary'` rows                                         |
| `created_at`          | `INTEGER NOT NULL`                   |                                                                             |

Payload shapes per `kind` — the `kind` column is the `AgentEvent`'s `type`, and the
payload is the event verbatim (see [agent-loop.md](./agent-loop.md)):

| `kind`                                                 | `payload`                                                         |
| ------------------------------------------------------ | ----------------------------------------------------------------- |
| `user_message` / `human_response` / `assistant_answer` | `{ type, content, sources? }`                                     |
| `tool_call`                                            | `{ type, id, name, args }`                                        |
| `tool_result`                                          | `{ type, id, name, output }`                                      |
| `error`                                                | `{ type, id, name, message }` — a compacted failure               |
| `approval_request` / `approval_response`               | `{ type, id, … }`                                                 |
| `summary`                                              | `{ type: "summary", content }` — one segment's digest             |
| `scratchpad`                                           | `{ type, ops: [{ section, content }] }` — working-memory mutation |

Indexes:

- `(conversation_id, turn_index)` — window queries
- `(conversation_id, kind, id)` — fast latest-summary lookup

There is no partial unique index on summary rows: multiple summary rows per
conversation are intentional.

## Summary: append segments, never update

Each windowing pass:

1. Read the un-summarized tail (`afterLastSummary()` — messages after the last summary).
2. If it exceeds `KEEP_LAST_TURNS`, summarize the **whole tail** into one segment.
3. **INSERT** a new `kind = 'summary'` row with `{ type, content }` and `summarizer_tokens`.

Each segment covers a distinct slice, so segments are **not** cumulative — `forModel()`
returns them all (plus the messages after the last one), and the model reads every one.

## Token usage: `usage_record` table

Each chat-path model call goes through [`Model`](../packages/platform/src/model/index.ts)
(`Model.fromOpenAI` today). The adapter stamps GenAI span attrs and, when a session
has bound `withUsageRecorder`, appends a normalized `UsageRecord` that is flushed to
`usage_record` (conversation-scoped). Transcript rows no longer carry token columns.

| `kind`       | Source                               |
| ------------ | ------------------------------------ |
| `parent`     | Orchestrator `agent.step`            |
| `fork`       | Sub-agent loop under `withForkUsage` |
| `handoff`    | `compressHandoff`                    |
| `summarizer` | Window `summarize`                   |

```sql
SELECT
  COALESCE(SUM(input_tokens), 0)        AS actual_input,
  COALESCE(SUM(cached_input_tokens), 0) AS cached_input,
  COALESCE(SUM(output_tokens), 0)       AS output_tokens
FROM usage_record
WHERE conversation_id = ? AND kind != 'summarizer';
```

Summarizer spend is tracked separately (`kind = 'summarizer'`) for the exit report.

## Runtime assembly

```ts
// events already includes the summary segments (as `summary` events), leading the list.
const events = await store.conversation.queryHistory(store.conversationId).forModel().execute();
const memories = (await store.memory.query().forProfile(store.profileId).execute()).map(
  (row) => row.text,
);

// The runner's reducer folds both into ONE packed <user> message.
const apiInput = buildMessage({ events, memories });
```

`forModel()` returns every `summary` segment plus the messages after the last one; the
reducer renders segments as `<conversation_summary>` at the head of the events, then
memories last, so the cached prefix stays stable.

## Migrations

Schema lives in
[`apps/cli/src/backend/db/schema.ts`](../apps/cli/src/backend/db/schema.ts).
SQL migrations are generated by drizzle-kit and applied automatically on startup.

```bash
just cli db-generate --name <change>   # regenerate SQL after editing schema.ts
just cli db-studio                     # browse the database
```

Migrations run on every open
([`apps/cli/src/backend/db/db.ts`](../apps/cli/src/backend/db/db.ts));
once the schema is current it is a no-op, so there is no separate setup step.

## Code map

| File                                                                          | Role                                            |
| ----------------------------------------------------------------------------- | ----------------------------------------------- |
| [`apps/cli/src/backend/index.ts`](../apps/cli/src/backend/index.ts)           | `Store` facade entry point                      |
| [`apps/cli/src/backend/store.ts`](../apps/cli/src/backend/store.ts)           | `LocalStore` composition                        |
| [`apps/cli/src/backend/profile/`](../apps/cli/src/backend/profile/)           | `ProfileFacade` + `ProfileRepository`           |
| [`apps/cli/src/backend/conversation/`](../apps/cli/src/backend/conversation/) | `ConversationFacade` + `ConversationRepository` |
| [`apps/cli/src/backend/memory/`](../apps/cli/src/backend/memory/)             | `MemoryFacade` + `MemoryRepository`             |
| [`apps/cli/src/backend/sources/`](../apps/cli/src/backend/sources/)           | `SourcesFacade` + `SourceRepository`            |
| [`apps/cli/src/backend/db/schema.ts`](../apps/cli/src/backend/db/schema.ts)   | Drizzle table definitions                       |
| [`apps/cli/src/backend/db/db.ts`](../apps/cli/src/backend/db/db.ts)           | Connection, WAL, migrations                     |
| `apps/cli/src/backend/db/migrations/`                                         | drizzle-kit generated SQL + journal             |

## Deliberate non-goals (v1)

- **UPDATE/DELETE on `conversation_item`** — strictly append-only.
- **Storing `last_activity_at`** — derived from `conversation_item`.
- **Showing summary rows in UI chat** — excluded from the history query.
