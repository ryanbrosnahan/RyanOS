import type {
  AiProvider,
  AiProviderResult,
  AiProviderStatus,
  IncomingMessage,
  PublicToolDefinition
} from "@ryanos/ai";
import { InMemoryRyanStore, type RyanStore } from "@ryanos/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { GmailClientLike } from "../src/email-triage.js";

class EmailToolAiProvider implements AiProvider {
  readonly name = "email-test";
  readonly mode = "none";

  constructor(private readonly result: AiProviderResult) {}

  async getStatus(): Promise<AiProviderStatus> {
    return {
      name: this.name,
      mode: this.mode,
      ready: true,
      setupRequired: false,
      setupActions: [],
      warnings: []
    };
  }

  async interpret(_message: IncomingMessage, _tools: PublicToolDefinition[]): Promise<AiProviderResult> {
    return this.result;
  }
}

function fakeGmailClient(): GmailClientLike {
  return {
    async doctor() {
      return {
        installed: true,
        ok: true,
        version: "gog v0.15.0"
      };
    },
    async listAccounts() {
      return [
        {
          email: "ryan@example.com",
          externalAccountId: "ryan@example.com",
          displayName: "Ryan",
          scopes: ["gmail"],
          status: "active",
          raw: {
            email: "ryan@example.com"
          }
        }
      ];
    },
    async searchMessages() {
      return [
        {
          id: "msg-1",
          threadId: "thread-1",
          subject: "Need your answer",
          from: "sender@example.com",
          snippet: "Can you confirm?",
          raw: {
            id: "msg-1"
          }
        }
      ];
    },
    async getMessage() {
      return {
        id: "msg-1",
        threadId: "thread-1",
        subject: "Need your answer",
        from: "sender@example.com",
        to: "ryan@example.com",
        date: "2026-06-04T15:00:00.000Z",
        snippet: "Can you confirm?",
        bodyText: "Can you confirm whether Friday works?",
        raw: {
          id: "msg-1"
        }
      };
    }
  };
}

function proposalAi(): AiProvider {
  return new EmailToolAiProvider({
    text: "Proposal stored.",
    toolCalls: [
      {
        name: "email.propose_action",
        input: {
          actionType: "reply",
          title: "Reply to sender about Friday",
          body: "Confirm whether Friday works.",
          priority: "high",
          draftReplyText: "Friday works for me.",
          rationale: "The sender asked for a direct confirmation.",
          confidence: 0.91
        }
      }
    ]
  });
}

describe("email integration API", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("syncs gog Gmail accounts into provider accounts", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("GOG_KEYRING_PASSWORD", "test-password");
    const app = buildApp({
      ai: proposalAi(),
      emailClient: fakeGmailClient()
    });

    const sync = await app.inject({
      method: "POST",
      url: "/v1/email/accounts/sync",
      payload: {
        userId: "local-owner"
      }
    });
    const accounts = await app.inject({
      method: "GET",
      url: "/v1/email/accounts?userId=local-owner"
    });
    await app.close();

    expect(sync.statusCode).toBe(200);
    expect(accounts.statusCode).toBe(200);
    expect(accounts.json()).toMatchObject({
      accounts: [
        {
          email: "ryan@example.com",
          settings: {
            enabled: true
          }
        }
      ]
    });
  });

  it("scans Gmail, stores proposals, and dedupes repeat scans", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("GOG_KEYRING_PASSWORD", "test-password");
    const app = buildApp({
      ai: proposalAi(),
      emailClient: fakeGmailClient()
    });

    const firstScan = await app.inject({
      method: "POST",
      url: "/v1/email/scan",
      payload: {
        userId: "local-owner"
      }
    });
    const secondScan = await app.inject({
      method: "POST",
      url: "/v1/email/scan",
      payload: {
        userId: "local-owner"
      }
    });
    const proposals = await app.inject({
      method: "GET",
      url: "/v1/email/proposals?userId=local-owner&status=proposed"
    });
    await app.close();

    expect(firstScan.statusCode).toBe(200);
    expect(secondScan.statusCode).toBe(200);
    expect(proposals.json().proposals).toHaveLength(1);
    expect(proposals.json().proposals[0]).toMatchObject({
      title: "Reply to sender about Friday",
      draftReplyText: "Friday works for me.",
      confidence: 91,
      account: {
        email: "ryan@example.com"
      },
      source: {
        title: "Need your answer"
      }
    });
  });

  it("accepts a proposal into one normal RyanOS item", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("GOG_KEYRING_PASSWORD", "test-password");
    const app = buildApp({
      ai: proposalAi(),
      emailClient: fakeGmailClient()
    });
    await app.inject({
      method: "POST",
      url: "/v1/email/scan",
      payload: {
        userId: "local-owner"
      }
    });
    const proposals = await app.inject({
      method: "GET",
      url: "/v1/email/proposals?userId=local-owner&status=proposed"
    });
    const proposalId = proposals.json().proposals[0].id as string;

    const accepted = await app.inject({
      method: "POST",
      url: `/v1/email/proposals/${proposalId}/accept`,
      payload: {
        userId: "local-owner"
      }
    });
    const items = await app.inject({
      method: "GET",
      url: "/v1/items?userId=local-owner&includeHidden=true"
    });
    await app.close();

    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({
      proposal: {
        status: "accepted"
      },
      item: {
        title: "Reply to sender about Friday",
        priority: "high"
      }
    });
    expect(items.json().items).toEqual([
      expect.objectContaining({
        title: "Reply to sender about Friday",
        status: "open"
      })
    ]);
  });

  it("rejects a proposal without creating an item", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const store: RyanStore = new InMemoryRyanStore();
    const account = await store.upsertProviderAccount({
      userId: "local-owner",
      provider: "gmail",
      externalAccountId: "ryan@example.com",
      email: "ryan@example.com"
    });
    const source = await store.upsertExternalSource({
      userId: "local-owner",
      provider: "gmail",
      providerAccountId: account.id,
      externalId: "msg-reject",
      title: "Newsletter"
    });
    const proposal = await store.upsertEmailActionProposal({
      userId: "local-owner",
      sourceId: source.id,
      providerAccountId: account.id,
      idempotencyKey: "gmail:reject",
      actionType: "task",
      title: "Read newsletter"
    });
    const app = buildApp({
      store,
      ai: proposalAi(),
      emailClient: fakeGmailClient()
    });

    const rejected = await app.inject({
      method: "POST",
      url: `/v1/email/proposals/${proposal.id}/reject`,
      payload: {
        userId: "local-owner"
      }
    });
    const items = await app.inject({
      method: "GET",
      url: "/v1/items?userId=local-owner&includeHidden=true"
    });
    await app.close();

    expect(rejected.statusCode).toBe(200);
    expect(rejected.json()).toMatchObject({
      proposal: {
        status: "rejected"
      }
    });
    expect(items.json().items).toEqual([]);
  });

  it("returns a scan error instead of throwing when gog auth is incomplete", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const app = buildApp({
      ai: proposalAi(),
      emailClient: {
        async doctor() {
          return {
            installed: true,
            ok: false,
            error: "credentials missing"
          };
        },
        async listAccounts() {
          throw new Error("credentials missing");
        },
        async searchMessages() {
          return [];
        },
        async getMessage() {
          throw new Error("not reached");
        }
      }
    });

    const scan = await app.inject({
      method: "POST",
      url: "/v1/email/scan",
      payload: {
        userId: "local-owner"
      }
    });
    await app.close();

    expect(scan.statusCode).toBe(200);
    expect(scan.json()).toMatchObject({
      result: {
        accountsScanned: 0,
        errors: [
          {
            error: expect.stringContaining("Gmail account sync failed")
          }
        ]
      }
    });
  });
});
