import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CodexLoginAiProvider, buildCodexPrompt } from "./index.js";
import type { IncomingMessage, PublicToolDefinition } from "./index.js";

const message: IncomingMessage = {
  id: "msg-1",
  provider: "web",
  chatId: "dev",
  userId: "local-owner",
  text: "add a task to check the RFP",
  timestamp: "2026-05-27T12:00:00.000Z",
  attachments: [],
  metadata: {}
};

const tools: PublicToolDefinition[] = [
  {
    name: "item.create",
    description: "Create a task.",
    metadata: {
      sideEffect: "state_write",
      confirmation: "not_required",
      retrySafety: "safe_with_idempotency_key"
    }
  }
];

async function createFakeCodexCommand(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "fake-codex-"));
  const path = join(dir, "codex");
  await writeFile(
    path,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "if [[ \"${1:-}\" == \"--version\" ]]; then echo 'codex 1.0.0'; exit 0; fi",
      "if [[ \"${1:-}\" == \"login\" && \"${2:-}\" == \"status\" ]]; then echo 'logged in'; exit 0; fi",
      "if [[ \"${1:-}\" == \"exec\" ]]; then",
      "  output_path=''",
      "  while [[ $# -gt 0 ]]; do",
      "    if [[ \"${1:-}\" == \"--output-last-message\" ]]; then",
      "      shift",
      "      output_path=\"${1:-}\"",
      "    fi",
      "    shift || true",
      "  done",
      "  echo 'WARN codex emitted unrelated stdout before the final message'",
      "  payload='{\"text\":\"ok\",\"toolCalls\":[{\"name\":\"item.create\",\"inputJson\":\"{\\\"title\\\":\\\"Check the RFP\\\",\\\"kind\\\":\\\"task\\\"}\"}],\"warnings\":[]}'",
      "  if [[ -n \"$output_path\" ]]; then printf '%s' \"$payload\" > \"$output_path\"; else printf '%s\\n' \"$payload\"; fi",
      "  exit 0",
      "fi",
      "echo 'unexpected args' >&2",
      "exit 1"
    ].join("\n")
  );
  await chmod(path, 0o755);
  return path;
}

describe("CodexLoginAiProvider", () => {
  it("includes tool input schemas in the Codex prompt", () => {
    const prompt = buildCodexPrompt(message, [
      {
        name: "recurrence.setPolicy",
        description: "Create or update recurrence rules for an item.",
        metadata: {
          sideEffect: "state_write",
          confirmation: "low_confidence",
          retrySafety: "safe_with_idempotency_key",
          descriptionForModel: "For once a week, use completion_based with intervalDays 7."
        },
        inputSchema: {
          type: "object",
          properties: {
            sourceMessageId: { type: "string" },
            dryRun: { type: "boolean" },
            itemRef: { type: "string" },
            policy: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: ["completion_based", "minimum_interval", "target_frequency"]
                },
                intervalDays: { type: "integer" }
              },
              required: ["type"]
            }
          },
          required: ["sourceMessageId", "itemRef", "policy"]
        }
      }
    ]);

    expect(prompt).toContain('"inputSchema"');
    expect(prompt).toContain('"completion_based"');
    expect(prompt).toContain('"intervalDays"');
    expect(prompt).not.toContain('"sourceMessageId"');
    expect(prompt).not.toContain('"dryRun"');
    expect(prompt).not.toContain('"interval" as a type');
  });

  it("uses Codex CLI structured output for tool calls", async () => {
    const codexCommand = await createFakeCodexCommand();
    const provider = new CodexLoginAiProvider({
      codexCommand,
      timeoutMs: 5_000
    });

    const status = await provider.getStatus();
    expect(status.ready).toBe(true);

    const result = await provider.interpret(message, tools);
    expect(result.toolCalls).toEqual([
      {
        name: "item.create",
        input: {
          title: "Check the RFP",
          kind: "task"
        }
      }
    ]);
  });
});
