set dotenv-load

default:
    @just --list

# Package / app justfiles: `just agent test`, `just cli start`, …
agent *args:
    just --justfile packages/agent/justfile --working-directory packages/agent {{ args }}
engine *args:
    just --justfile packages/engine/justfile --working-directory packages/engine {{ args }}
platform *args:
    just --justfile packages/platform/justfile --working-directory packages/platform {{ args }}
tools *args:
    just --justfile packages/tools/justfile --working-directory packages/tools {{ args }}
store *args:
    just --justfile packages/store/justfile --working-directory packages/store {{ args }}
cli *args:
    just --justfile apps/cli/justfile --working-directory apps/cli {{ args }}

# --- workspace gates ---

typecheck:
    pnpm exec tsc --noEmit -p tsconfig.json
    pnpm exec tsc --noEmit -p apps/cli/tsconfig.json
lint *args:
    pnpm exec oxlint {{ args }}
lint-fix:
    pnpm exec oxlint --fix
format:
    pnpm exec oxfmt .
format-check:
    pnpm exec oxfmt --check .
knip:
    pnpm exec knip --include files,exports,types

# Unit tests across every app + package in one vitest process (see vitest.config.ts).
# For a single member use its justfile: `just agent test`, `just cli test`, …
test *args:
    pnpm exec vitest run {{ args }}
test-watch *args:
    pnpm exec vitest {{ args }}

# Typecheck + lint + format-check + dead-code check + unit tests — the pre-commit gate.
check: typecheck lint format-check knip test

# --- workspace suites (every app/package that has them) ---

integration:
    just cli integration
e2e *args:
    just cli e2e {{ args }}
e2e-full *args:
    just cli e2e-full {{ args }}
eval *args:
    just cli eval {{ args }}

# --- infra (docker compose at repo root) ---

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
