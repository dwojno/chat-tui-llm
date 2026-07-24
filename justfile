set dotenv-load

default:
    @just --list

# --- dev loop ---

start:
    pnpm --filter chat-cli start
typecheck:
    pnpm exec tsc --noEmit
lint *args:
    pnpm exec oxlint {{ args }}
lint-fix:
    pnpm exec oxlint --fix
format:
    pnpm exec oxfmt .
format-check:
    pnpm exec oxfmt --check .
test *args:
    pnpm exec vitest run {{ args }}
test-watch:
    pnpm exec vitest

# Typecheck + lint + format-check + test — the pre-commit gate.
check: typecheck lint format-check test

# --- db ---

db-generate *args:
    pnpm --dir apps/cli exec drizzle-kit generate {{ args }}
db-studio:
    pnpm --dir apps/cli exec drizzle-kit studio
db-migrate:
    pnpm --dir apps/cli exec drizzle-kit migrate

# --- infra (docker compose; --wait blocks on healthchecks) ---

# Bring up the full stack (Qdrant + Langfuse) and wait until healthy.
infra:
    docker compose up -d --wait
infra-down:
    docker compose down
infra-clear:
    docker compose down -v

# Bring up only Qdrant (all the RAG pipeline needs) and wait until healthy.
qdrant:
    docker compose up -d --wait qdrant

# --- evals (need a real OPENAI_API_KEY) ---

eval *args: qdrant
    pnpm exec evalite run {{ args }}
eval-watch: qdrant
    pnpm exec evalite watch
eval-rag: qdrant
    pnpm exec evalite run apps/cli/evals/suites/rag-eval.eval.ts

# --- integration ---

# Real RAG tools against real Qdrant + OpenAI (reranker off for determinism).
integration: qdrant
    RAG_INTEGRATION=1 RAG_RERANK_ENABLED=false pnpm exec vitest run apps/cli/tests/backend/rag packages/tools/tests/rag-tools.integration.test.ts

# --- e2e (PTY-driven real TUI; streams the live frames to the console) ---
# One config (vitest.e2e.config.ts); the recipes narrow it via a CLI filename
# filter and override the timeout on the CLI — no per-suite config files.

# Real TUI in a pseudo-terminal + real Qdrant, chat model mocked — deterministic.
e2e *args: qdrant
    RAG_RERANK_ENABLED=false pnpm exec vitest run --config vitest.e2e.config.ts --testTimeout 120000 e2e.ts {{ args }}

# Same PTY harness with the real chat model — the full flow.
e2e-full *args: qdrant
    RAG_RERANK_ENABLED=false pnpm exec vitest run --config vitest.e2e.config.ts e2e-full.ts {{ args }}
