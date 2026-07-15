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

const MEMORIES = [
  "The user is allergic to peanuts.",
  "The user lives in Seattle.",
  "The user's favorite programming language is Rust.",
];

const withMemories = (prompt: string): ProbeSpec => ({
  prompt,
  context: { memories: MEMORIES },
});

evalite<ProbeSpec, ProbeResult, Expected>("context discretion", {
  data: () => [
    {
      input: withMemories("Good morning!"),
      expected: { mustOmit: ["peanut", "Seattle", "Rust"] },
    },
    {
      input: withMemories("What year did the first moon landing happen?"),
      expected: {
        mustContain: ["1969"],
        mustOmit: ["peanut", "Seattle", "Rust"],
      },
    },
    {
      input: withMemories("What are some good cities for coffee lovers?"),
      expected: { mustOmit: ["Seattle", "peanut", "Rust"] },
    },
    {
      input: withMemories("Recommend a good novel to read this weekend."),
      expected: { mustOmit: ["peanut", "Seattle", "Rust"] },
    },
    {
      input: withMemories("Tell me a bit about yourself."),
      expected: { mustOmit: ["peanut", "Seattle", "Rust"] },
    },
    {
      input: withMemories("What kinds of things can you help me with?"),
      expected: { mustOmit: ["peanut", "Seattle", "Rust"] },
    },

    {
      input: withMemories("Can you suggest a quick snack I could make for myself?"),
      expected: {
        judge:
          "A passing answer accounts for the user being allergic to peanuts — " +
          "either by avoiding peanut-based snacks or explicitly noting the " +
          "allergy. It must NOT recommend a peanut snack.",
      },
    },
    {
      input: withMemories("What programming language do I like best?"),
      expected: { mustContain: ["Rust"] },
    },
    {
      input: withMemories("Remind me — where do I live again?"),
      expected: { mustContain: ["Seattle"] },
    },
    {
      input: withMemories("Do I have any food allergies I should watch out for?"),
      expected: { mustContain: ["peanut"] },
    },
    {
      input: withMemories("Recommend somewhere to grab dinner tonight."),
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
