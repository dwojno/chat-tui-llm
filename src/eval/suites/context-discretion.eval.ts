import { evalite } from "evalite";
import {
  avoidsForbidden,
  judged,
  mentionsRequired,
  probePrompt,
  type Expected,
  type ProbeResult,
  type ProbeSpec,
} from "../harness";

/**
 * Context discretion (see the <context> rules in buildContextBlock). Stored
 * facts are injected as background memory with an explicit rule: never volunteer
 * them on greetings / small talk / unrelated messages, but DO use them when the
 * current message clearly calls for it. Both failure modes are pinned: leaking a
 * fact unprompted, and failing to use one when relevant.
 */
const FACTS = [
  "The user is allergic to peanuts.",
  "The user lives in Seattle.",
  "The user's favorite programming language is Rust.",
];

const withFacts = (prompt: string): ProbeSpec => ({ prompt, context: { facts: FACTS } });

evalite<ProbeSpec, ProbeResult, Expected>("context discretion", {
  data: () => [
    // ── Must NOT leak on irrelevant messages ─────────────────────────────
    {
      input: withFacts("Good morning!"),
      expected: { mustOmit: ["peanut", "Seattle", "Rust"] },
    },
    {
      input: withFacts("What year did the first moon landing happen?"),
      expected: { mustContain: ["1969"], mustOmit: ["peanut", "Seattle", "Rust"] },
    },
    // EDGE: topic brushes a fact (a city question) but never asks about the
    // user — the model must not blurt "since you live in Seattle…".
    {
      input: withFacts("What are some good cities for coffee lovers?"),
      expected: { mustOmit: ["Seattle", "peanut", "Rust"] },
    },
    // EDGE: open-ended recommendation with no personal hook — no facts belong here.
    {
      input: withFacts("Recommend a good novel to read this weekend."),
      expected: { mustOmit: ["peanut", "Seattle", "Rust"] },
    },
    // EDGE: "tell me about yourself" is about the ASSISTANT, not the user —
    // must not recite the user's stored facts.
    {
      input: withFacts("Tell me a bit about yourself."),
      expected: { mustOmit: ["peanut", "Seattle", "Rust"] },
    },
    // EDGE: capability question — must not dump memory.
    {
      input: withFacts("What kinds of things can you help me with?"),
      expected: { mustOmit: ["peanut", "Seattle", "Rust"] },
    },

    // ── Must USE the fact when clearly relevant ──────────────────────────
    {
      input: withFacts("Can you suggest a quick snack I could make for myself?"),
      expected: {
        judge:
          "A passing answer accounts for the user being allergic to peanuts — " +
          "either by avoiding peanut-based snacks or explicitly noting the " +
          "allergy. It must NOT recommend a peanut snack.",
      },
    },
    {
      input: withFacts("What programming language do I like best?"),
      expected: { mustContain: ["Rust"] },
    },
    // EDGE: indirect recall — "where do I live" must surface the stored city.
    {
      input: withFacts("Remind me — where do I live again?"),
      expected: { mustContain: ["Seattle"] },
    },
    // EDGE: indirect allergy probe — must surface the allergy.
    {
      input: withFacts("Do I have any food allergies I should watch out for?"),
      expected: { mustContain: ["peanut"] },
    },
    // EDGE: relevance requires COMBINING facts — a local dinner rec should use
    // the Seattle location and steer clear of peanuts.
    {
      input: withFacts("Recommend somewhere to grab dinner tonight."),
      expected: {
        judge:
          "A passing answer treats the user as being in Seattle (a local " +
          "recommendation or asking to confirm the Seattle area) rather than a " +
          "generic answer, and does not suggest a peanut-heavy cuisine without " +
          "noting the allergy.",
      },
    },
  ],
  task: (spec) => probePrompt(spec),
  scorers: [avoidsForbidden, mentionsRequired, judged],
});
