set dotenv-load

default:
    @just --list

# --- dev loop ---

start:
    pnpm exec tsx src/cli.ts
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
    pnpm exec drizzle-kit generate {{ args }}
db-studio:
    pnpm exec drizzle-kit studio

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
    pnpm exec evalite run evals/suites/rag-eval.eval.ts

# --- integration ---

# Real RAG tools against real Qdrant + OpenAI (reranker off for determinism).
integration: qdrant
    RAG_INTEGRATION=1 RAG_RERANK_ENABLED=false pnpm exec vitest run tests/store/rag tests/app/tools/rag-tools.integration.test.ts
