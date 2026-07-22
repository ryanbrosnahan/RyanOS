import type {
  AiProvider,
  AiProviderResult,
  AiProviderStatus,
  IncomingMessage,
  PublicToolDefinition
} from "@ryanos/ai";
import { InMemoryRyanStore } from "@ryanos/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { GmailClientLike } from "../src/email-triage.js";
import { signInternalEmailScanRequest } from "../src/internal-email-auth.js";

class BatchAi implements AiProvider {
  readonly name = "scheduler-test";
  readonly mode = "none";

  async getStatus(): Promise<AiProviderStatus> {
    return { name: this.name, mode: this.mode, ready: true, setupRequired: false, setupActions: [], warnings: [] };
  }

  async interpret(message: IncomingMessage, _tools: PublicToolDefinition[]): Promise<AiProviderResult> {
    const messageIds = [...message.text.matchAll(/^Message ID: (.+)$/gm)].map((match) => match[1]);
    return {
      text: "Classified.",
      toolCalls: [{
        name: "email.classify_batch",
        input: {
          decisions: messageIds.map((messageId) => ({
            messageId,
            outcome: "actionable",
            actionType: "task",
            title: `Handle ${messageId}`,
            reason: "A response is required.",
            confidence: 90
          }))
        }
      }]
    };
  }
}

function client(): GmailClientLike {
  return {
    async doctor() {
      return { installed: true, ok: true };
    },
    async listAccounts() {
      return [];
    },
    async searchMessagePage({ accountEmail }) {
      const suffix = accountEmail.startsWith("one") ? "one" : "two";
      return { messages: [{ id: `thread-${suffix}`, threadId: `thread-${suffix}`, raw: {} }] };
    },
    async getThread({ accountEmail, threadId }) {
      const suffix = accountEmail.startsWith("one") ? "one" : "two";
      return {
        id: threadId,
        messages: [{
          id: `message-${suffix}`,
          threadId,
          subject: `Action ${suffix}`,
          from: `sender-${suffix}@example.com`,
          to: accountEmail,
          date: "2026-07-22T12:00:00.000Z",
          bodyText: "Please take care of this.",
          raw: {}
        }],
        raw: {}
      };
    }
  };
}

describe("scheduled email scans", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("requires a signed request and scans every Gmail tenant", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const masterKey = Buffer.alloc(32, 9);
    vi.stubEnv("RYANOS_MASTER_KEY", masterKey.toString("hex"));
    const store = new InMemoryRyanStore();
    await store.upsertProviderAccount({
      userId: "user-one",
      provider: "gmail",
      externalAccountId: "one@example.com",
      email: "one@example.com"
    });
    await store.upsertProviderAccount({
      userId: "user-two",
      provider: "gmail",
      externalAccountId: "two@example.com",
      email: "two@example.com"
    });
    const app = buildApp({ store, ai: new BatchAi(), emailClient: client() });
    const unsigned = await app.inject({ method: "POST", url: "/v1/internal/email/scan-due", payload: {} });
    expect(unsigned.statusCode).toBe(401);

    const payload = { syncAccounts: false };
    const body = JSON.stringify(payload);
    const signed = signInternalEmailScanRequest(masterKey, body);
    const response = await app.inject({
      method: "POST",
      url: "/v1/internal/email/scan-due",
      headers: {
        "x-ryanos-internal-timestamp": signed.timestamp,
        "x-ryanos-internal-signature": signed.signature
      },
      payload
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ usersDiscovered: 2 });
    await expect(store.listEmailActionProposals({ userId: "user-one" })).resolves.toHaveLength(1);
    await expect(store.listEmailActionProposals({ userId: "user-two" })).resolves.toHaveLength(1);
    await app.close();
  });
});
