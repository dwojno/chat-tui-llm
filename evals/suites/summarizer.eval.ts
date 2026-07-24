import { evalite } from "evalite";
import { summarize } from "@chat/engine";
import type { AgentEvent } from "@chat/agent";
import { Model } from "@chat/platform/model";
import { SUMMARIZER_MODEL } from "@/app/config";
import {
  judged,
  mentionsRequired,
  openai,
  withinWordLimit,
  type Expected,
  type ProbeResult,
} from "../harness";

const user = (content: string): AgentEvent => ({ type: "user_message", content });
const assistant = (content: string): AgentEvent => ({ type: "assistant_answer", content });

const TRIP: AgentEvent[] = [
  user("I am planning a trip to Japan in October. Budget is $3000."),
  assistant(
    "October is a great time — mild weather and autumn leaves. With $3000 you " +
      "can cover flights, a rail pass, and mid-range hotels for about 10 days.",
  ),
  user("I want to visit Kyoto and Osaka, and I am vegetarian."),
  assistant(
    "Noted: Kyoto and Osaka, vegetarian meals. Kyoto has excellent shojin-ryori " +
      "(Buddhist vegetarian cuisine). I recommend booking the Kyoto hotel early.",
  ),
  user("Also I decided NOT to rent a car — trains only."),
];

const REVISED: AgentEvent[] = [
  ...TRIP,
  user("Actually, bump the budget to $5000 — and skip Osaka, add Nara instead."),
  assistant("Updated: $5000 budget, and Nara replaces Osaka."),
  user("One more thing: I'm NOT interested in visiting any temples."),
];

interface SummarizeInput {
  evicted: AgentEvent[];
  prior?: string;
}

evalite<SummarizeInput, ProbeResult, Expected>("summarizer fidelity", {
  data: () => [
    {
      input: { evicted: TRIP },
      expected: {
        maxWords: 170,
        mustContain: ["Japan", "vegetarian"],
        judge:
          "A passing summary preserves ALL of these concrete facts: a trip to " +
          "Japan in October, a ~$3000 budget, destinations Kyoto and Osaka, the " +
          "user is vegetarian, and the decision to use trains (no rental car). It " +
          "should be concise and free of pleasantries.",
      },
    },
    {
      input: { evicted: REVISED },
      expected: {
        maxWords: 170,
        judge:
          "A passing summary reflects the FINAL state after the user changed " +
          "their mind: budget $5000 (NOT $3000), destinations Kyoto and Nara " +
          "(NOT Osaka), and it must preserve that the user does NOT want to " +
          "visit temples. Mentioning the old $3000 or Osaka as current is a fail.",
      },
    },
    {
      input: {
        prior:
          "The user is a vegetarian software engineer from Toronto planning a " +
          "2-week trip. They are allergic to shellfish.",
        evicted: [
          user("I booked the flights to Lisbon for May."),
          assistant("Great — Lisbon in May is lovely."),
        ],
      },
      expected: {
        maxWords: 170,
        judge:
          "A passing summary keeps the prior-summary facts (vegetarian, from " +
          "Toronto, allergic to shellfish, ~2-week trip) AND folds in the new " +
          "ones (flights booked to Lisbon in May). Dropping any prior fact is a fail.",
      },
    },
  ],
  task: async ({ evicted, prior }) => {
    const { text } = await summarize({
      model: Model.fromOpenAI(openai()),
      modelName: SUMMARIZER_MODEL,
      priorSummary: prior ?? "",
      evicted,
    });
    return { text, toolCalls: [], parsed: null, usage: undefined };
  },
  scorers: [withinWordLimit, mentionsRequired, judged],
});
