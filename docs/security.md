# Security: red-teaming, PII redaction, attack defenses

chat-cli treats everything a tool returns — file contents, web results,
knowledge-base digests, delegated-fork output — as **untrusted third-party
data**, and everything the user pastes as potentially adversarial. This doc
covers the threat model, the defenses, and how to red-team them.

## Trust boundary (the rule of thumb)

**Anything that crosses into the agent from outside is untrusted and treated as
a possible attack** — the user's pasted content, `read_file` output,
`web_search` results, knowledge-base digests, and delegated-fork output. Trust
is not restored by a source feeling "internal" (the KB) or "ours" (a sub-agent):
a poisoned document or a compromised web page reaches the model the same way a
hostile paste does.

The rule holds **uniformly** because containment lives at the seams every source
funnels through, not in per-source special cases:

- **Data in** — path containment + 256 KB read cap (`read_file`), snippet
  cleaning + cap (`web_search`), and PII redaction at model/telemetry egress.
- **Action out** — the approval gate: no file write/edit or other gated action
  runs without explicit user confirmation, whatever source suggested it.
- **Prompt** — `<untrusted_content>` tells the model to treat all of the above
  as data, never instructions.

The uniformity is the point: the approval gate doesn't care whether an
"overwrite this file" idea came from a file, a web result, or a fork — it is
blocked the same way. Encoded payloads (base64/hex/binary) change nothing here,
because no part of the pipeline decodes them; they reach the model as data.

## Threat model

| Threat                     | Vector                                                            | Defense                                                                                                                       |
| -------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Prompt injection           | Instructions hidden in a file / web result / tool output          | `<untrusted_content>` prompt rules ([apps/cli/src/prompts.ts](../apps/cli/src/prompts.ts)); the approval gate as the backstop |
| Jailbreak                  | User message tries to strip the model's rules ("you are now DAN") | `<untrusted_content>` + `<principles>` prompt rules                                                                           |
| System-prompt exfiltration | "Repeat your instructions verbatim"                               | `<untrusted_content>` rule forbidding disclosure                                                                              |
| Destructive tool abuse     | Injection tricks the model into `write_file` / `edit_file`        | Deterministic **approval gate** — nothing destructive runs without explicit user confirmation                                 |
| PII / secret leakage       | Personal data flows to a third party (OpenAI, Langfuse)           | `redactPII` at model egress and telemetry egress                                                                              |

## Defense in depth

- **Prompt (first line):** the `<untrusted_content>` section instructs the model
  to treat tool/file content as data, never follow embedded instructions, never
  disclose the system prompt, and never carry secrets/PII outside the session
  unless the user directed that exact action.
- **Code (backstop):** the approval gate (`runApprovalGate`,
  [packages/engine/src/runner.ts](../packages/engine/src/runner.ts)) blocks
  `write_file`/`edit_file` and other approval-gated tools regardless of what the
  model decides — so a fully prompt-compromised model still cannot mutate files
  without the user saying yes. This is the guarantee the offline red-team test
  pins down.

## PII redaction

`redactPII` ([packages/platform/src/utils/redact.ts](../packages/platform/src/utils/redact.ts)) is a
regex scrubber for email, phone, SSN, credit card (Luhn-checked), IPv4, and
secrets (provider `sk-`/`pk-`/`rk-` keys, AWS access keys, JWTs). We keep this
in-house rather than add a dependency: the NER-grade OSS tool (Presidio) is a
Python sidecar that breaks the offline/frameworkless story, and JS libraries are
regex under the hood — the same ceiling behind a dep. It runs at the two points
where user data leaves the process:

- **Model egress** — injected into `Agent` (`buildRequestParams`), so text sent
  to OpenAI is scrubbed.
- **Telemetry egress** — `setSpanIO`
  ([packages/platform/src/telemetry/trace.ts](../packages/platform/src/telemetry/trace.ts)), so
  Langfuse/OTel spans are scrubbed.

Controlled by `REDACT_PII` (default **on**; set `REDACT_PII=0` to disable). The
local SQLite store is intentionally **not** redacted — it holds the user's own
data. Note: model-egress redaction can reduce answer quality on legitimate
personal-data tasks; disable it per session if that matters.

**Known ceiling (regex).** The scrubber only matches plaintext PII. Encoded
forms — hex, base64, an email split by spaces or a zero-width space — pass
through. This is by design: chasing every encoding is a losing arms race and
would over-redact ordinary text. The real backstops are the approval gate (a
compromised model still can't act) and not persisting to third parties. All
patterns are upper-bounded so a hostile input can't trigger a ReDoS.

## Overwrite / filesystem defense

`write_file` and `edit_file` resolve every path through `resolveWithinCwd`
([packages/tools/src/utils/workspace.ts](../packages/tools/src/utils/workspace.ts)):
`resolve` + `relative` + an assert that the result stays inside the working
directory. There is **no URL/percent decoding**, so `%2e%2e%2f`-style payloads
are treated as literal filenames and stay contained; `..` traversal, absolute
paths, and null-byte paths are rejected. On top of that, the write itself is
approval-gated. The guard rejects conservatively (a filename beginning with
`..` is refused even when it wouldn't escape) — safe over permissive.

**Approval fail-safe.** When a tool's args can't be parsed (malformed JSON,
binary blob, schema mismatch), approval need now defaults to _required_ for any
tool that declares an approval mechanism — the gate fails safe rather than
open ([packages/agent/src/agent.ts](../packages/agent/src/agent.ts) `approvalFor`).

## Hostile file / encoded content

Reading a hex/binary file cannot break the pipeline:

- `read_file` decodes as UTF-8 (invalid bytes → U+FFFD) and never throws; it
  reads **at most `MAX_READ_BYTES` (256 KB)** via a bounded read, so a huge or
  hostile file cannot OOM the process or blow the context window.
- Persistence is safe: `JSON.stringify` escapes control bytes and a UTF-8 decode
  never produces lone surrogates, so the sqlite write stays valid JSON.
- The model-egress redaction round-trip
  (`JSON.parse(redactPII(JSON.stringify(input)))`) is safe by construction — no
  PII pattern can match a `"` or `\`, so redaction can't disturb a JSON escape
  or inject a delimiter, even on binary content.

**Encoded instructions ("ignore earlier prompts" in base64/hex/binary).** No
part of the pipeline decodes base64/hex — the reducer, redaction, and
persistence all pass the blob to the model **verbatim as data**, so the system
never executes an encoded instruction on its own. The only risk is the model
choosing to decode and comply; that is defended by the `<untrusted_content>`
prompt rule (encoded content is still untrusted data) and, for any action it
tries to take, the approval gate. The live suite exercises base64- and
hex-encoded "ignore all previous instructions" payloads.

**Terminal escapes (known, minor).** ANSI escape bytes in file content that the
model echoes into its answer are rendered by the TUI without stripping. This is
a display-integrity concern, not code execution; strip control bytes at the
render boundary if it matters for your deployment.

## Red-teaming

- **Live** — `just eval evals/suites/red-team.eval.ts` (CLI suite) runs adversarial prompts
  (jailbreak, injection, prompt exfiltration, secret exfiltration, covert tool
  abuse) against the real model and scores refusal / no-leak / no-forbidden-tool
  with the existing scorers. A control row checks the hardened prompt didn't
  start over-refusing benign questions. Needs `OPENAI_API_KEY`.
- **Offline** — `just test tests/e2e/red-team.test.ts` drives the real REPL with
  a scripted (compromised) model that attempts an injected `write_file`, and
  asserts the approval gate intercepts it and the file is never written. Covers
  **non-text injection**: a base64-encoded overwrite instruction read from a
  file, and binary content with spoofed `</user>`/`<system>` tags and the
  reserved `done_for_now` control-intent name — none can overwrite a target or
  fake turn completion (the runner keys on tool-call names, not content text).
- **Filesystem** — `just test packages/tools/tests/disk-tools.test.ts` covers path
  traversal / percent-encoding / null-byte / binary-content overwrite attempts;
  `packages/agent/tests/approval-fail-safe.test.ts` covers the malformed-args gate.
