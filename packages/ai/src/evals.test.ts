import { describe, expect, it } from "vitest";
import { ScriptedAiProvider, runIntentEvalSuite } from "./evals.js";
import type { IncomingMessage, PublicToolDefinition } from "./index.js";

const message: IncomingMessage = {
  id: "msg-1",
  provider: "web",
  chatId: "dev",
  userId: "local-owner",
  text: "I changed the sheets yesterday",
  timestamp: "2026-05-27T12:00:00.000Z",
  attachments: [],
  metadata: {}
};

const tools: PublicToolDefinition[] = [
  {
    name: "recurrence.recordEvent",
    description: "Record that a recurring thing happened.",
    metadata: {
      sideEffect: "state_write",
      confirmation: "low_confidence",
      retrySafety: "safe_with_idempotency_key"
    }
  }
];

describe("intent eval harness", () => {
  it("checks expected tool calls from a provider", async () => {
    const provider = new ScriptedAiProvider([
      {
        matchText: message.text,
        result: {
          toolCalls: [
            {
              name: "recurrence.recordEvent",
              input: {
                recurrenceRef: "sheets",
                eventType: "completed"
              }
            }
          ]
        }
      }
    ]);

    const result = await runIntentEvalSuite({
      provider,
      tools,
      cases: [
        {
          id: "record-sheets-complete",
          message,
          expectedToolCalls: [
            {
              name: "recurrence.recordEvent",
              inputContains: {
                eventType: "completed"
              }
            }
          ]
        }
      ]
    });

    expect(result.passed).toBe(true);
    expect(result.cases[0]?.errors).toEqual([]);
  });
});
