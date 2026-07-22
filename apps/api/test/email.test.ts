import type {
  AiProvider,
  AiProviderResult,
  AiProviderStatus,
  IncomingMessage,
  PublicToolDefinition
} from "@ryanos/ai";
import { InMemoryRyanStore, type EmailActionProposalListFilters, type RyanStore } from "@ryanos/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { GmailClientLike } from "../src/email-triage.js";

class EmailToolAiProvider implements AiProvider {
  readonly name = "email-test";
  readonly mode = "none";
  calls = 0;

  constructor(private readonly result: AiProviderResult | ((callCount: number) => AiProviderResult)) {}

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
    this.calls += 1;
    return typeof this.result === "function" ? this.result(this.calls) : this.result;
  }
}

class AliasOwnerStore extends InMemoryRyanStore {
  constructor(
    private readonly aliasUserId: string,
    private readonly resolvedUserId: string
  ) {
    super();
  }

  override async listEmailActionProposals(filters: EmailActionProposalListFilters) {
    return super.listEmailActionProposals({
      ...filters,
      userId: filters.userId === this.aliasUserId ? this.resolvedUserId : filters.userId
    });
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
    async searchMessagePage() {
      return { messages: [
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
      ] };
    },
    async getThread() {
      return { id: "thread-1", messages: [{
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
      }], raw: {} };
    }
  };
}

function proposalResult(title = "Reply to sender about Friday", messageId = "msg-1"): AiProviderResult {
  return {
    text: "Proposal stored.",
    toolCalls: [
      {
        name: "email.classify_batch",
        input: {
          decisions: [{
            messageId,
            outcome: "actionable",
            actionType: "reply",
            title,
            body: "Confirm whether Friday works.",
            priority: "high",
            draftReplyText: "Friday works for me.",
            reason: "The sender asked for a direct confirmation.",
            rationale: "The sender asked for a direct confirmation.",
            confidence: 0.91
          }]
        }
      }
    ]
  };
}

function proposalAi(): EmailToolAiProvider {
  return new EmailToolAiProvider(proposalResult());
}

function mixedInboxGmailClient(): GmailClientLike {
  const messages = new Map([
    [
      "human-1",
      {
        id: "human-1",
        threadId: "thread-human",
        subject: "Can you confirm Friday?",
        from: "Shaun Smith <shaun@example.com>",
        to: "ryan@example.com",
        date: "2026-06-04T15:00:00.000Z",
        snippet: "Can you confirm Friday?",
        bodyText: "Can you confirm whether Friday works?",
        raw: {
          id: "human-1"
        }
      }
    ],
    [
      "google-security",
      {
        id: "google-security",
        threadId: "thread-google",
        subject: "Security alert",
        from: "Google <no-reply@accounts.google.com>",
        to: "ryan@example.com",
        date: "2026-06-04T16:00:00.000Z",
        snippet: "A new sign-in was detected.",
        bodyText: "Review your recent security activity.",
        raw: {
          id: "google-security"
        }
      }
    ],
    [
      "chase-1",
      {
        id: "chase-1",
        threadId: "thread-chase",
        subject: "Your Chase statement is ready",
        from: "Chase <service@chase.com>",
        to: "ryan@example.com",
        date: "2026-06-04T17:00:00.000Z",
        snippet: "Your statement is ready.",
        bodyText: "Your statement is ready to view.",
        raw: {
          id: "chase-1"
        }
      }
    ]
  ]);
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
    async searchMessagePage() {
      return { messages: [...messages.values()].map((message) => ({
        id: message.id,
        threadId: message.threadId,
        subject: message.subject,
        from: message.from,
        snippet: message.snippet,
        raw: {
          id: message.id
        }
      })) };
    },
    async getThread({ threadId }) {
      const message = [...messages.values()].find((candidate) => candidate.threadId === threadId);
      if (!message) throw new Error(`Unknown thread ${threadId}`);
      return { id: threadId, messages: [message], raw: {} };
    }
  };
}

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
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

  it("dedupes repeat Gmail scans when AI wording changes", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("GOG_KEYRING_PASSWORD", "test-password");
    const ai = new EmailToolAiProvider((callCount) =>
      proposalResult(callCount === 1 ? "Reply to sender about Friday" : "Follow up with sender about Friday")
    );
    const app = buildApp({
      ai,
      emailClient: fakeGmailClient()
    });

    await app.inject({
      method: "POST",
      url: "/v1/email/scan",
      payload: {
        userId: "local-owner"
      }
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
    await app.close();

    expect(ai.calls).toBe(1);
    expect(proposals.json().proposals).toHaveLength(1);
    expect(proposals.json().proposals[0]).toMatchObject({
      title: "Reply to sender about Friday"
    });
  });

  it("paginates past unchanged threads to drain unseen mail", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const ai = new EmailToolAiProvider((callCount) =>
      proposalResult(`Handle message ${callCount}`, `msg-${callCount}`)
    );
    const threadMessage = (number: number) => ({
      id: `msg-${number}`,
      threadId: `thread-${number}`,
      subject: `Request ${number}`,
      from: `sender${number}@example.com`,
      to: "ryan@example.com",
      date: `2026-06-0${number + 3}T15:00:00.000Z`,
      bodyText: `Please handle request ${number}.`,
      raw: {}
    });
    const gmail: GmailClientLike = {
      ...fakeGmailClient(),
      async searchMessagePage({ pageToken }) {
        return pageToken
          ? { messages: [{ id: "thread-2", threadId: "thread-2", raw: {} }] }
          : { messages: [{ id: "thread-1", threadId: "thread-1", raw: {} }], nextPageToken: "page-2" };
      },
      async getThread({ threadId }) {
        const number = threadId.endsWith("2") ? 2 : 1;
        return { id: threadId, messages: [threadMessage(number)], raw: {} };
      }
    };
    const app = buildApp({ ai, emailClient: gmail });
    const first = await app.inject({
      method: "POST",
      url: "/v1/email/scan",
      payload: { maxPerAccount: 1 }
    });
    const second = await app.inject({
      method: "POST",
      url: "/v1/email/scan",
      payload: { maxPerAccount: 1 }
    });
    const proposals = await app.inject({ method: "GET", url: "/v1/email/proposals?status=proposed" });
    await app.close();

    expect(first.json().result).toMatchObject({ unseenThreadsEvaluated: 1, backlog: 1 });
    expect(second.json().result).toMatchObject({ messagesSeen: 2, unchangedDecisions: 1, unseenThreadsEvaluated: 1 });
    expect(ai.calls).toBe(2);
    expect(proposals.json().proposals).toHaveLength(2);
  });

  it("uses automated-email traits as model signals instead of hard filters", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("GOG_KEYRING_PASSWORD", "test-password");
    const ai = new EmailToolAiProvider({
      text: "Classified all messages.",
      toolCalls: [{
        name: "email.classify_batch",
        input: {
          decisions: [
            {
              messageId: "human-1",
              outcome: "actionable",
              actionType: "reply",
              title: "Reply about Friday",
              reason: "A direct response was requested.",
              confidence: 95
            },
            {
              messageId: "google-security",
              outcome: "no_action",
              reason: "Informational security notice.",
              confidence: 90
            },
            {
              messageId: "chase-1",
              outcome: "no_action",
              reason: "Routine statement notice.",
              confidence: 94
            }
          ]
        }
      }]
    });
    const app = buildApp({
      ai,
      emailClient: mixedInboxGmailClient()
    });

    const scan = await app.inject({
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

    expect(scan.statusCode).toBe(200);
    expect(scan.json()).toMatchObject({
      result: {
        accountsScanned: 1,
        messagesSeen: 3,
        messagesFetched: 3,
        messagesSkippedByFilter: 0,
        noActionDecisions: 2,
        proposalsCreatedOrUpdated: 1
      }
    });
    expect(ai.calls).toBe(1);
    expect(proposals.json().proposals).toHaveLength(1);
    expect(proposals.json().proposals[0]).toMatchObject({
      source: {
        title: "Can you confirm Friday?"
      }
    });
  });

  it("applies exact likely sender preferences before domain never rules without forcing a proposal", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const ai = new EmailToolAiProvider({
      text: "No action.",
      toolCalls: [{
        name: "email.classify_batch",
        input: {
          decisions: [{
            messageId: "msg-1",
            outcome: "no_action",
            reason: "Informational only.",
            confidence: 88
          }]
        }
      }]
    });
    const app = buildApp({ ai, emailClient: fakeGmailClient() });
    await app.inject({
      method: "POST",
      url: "/v1/email/sender-preferences",
      payload: { matchType: "domain", value: "example.com", disposition: "never" }
    });
    await app.inject({
      method: "POST",
      url: "/v1/email/sender-preferences",
      payload: { matchType: "address", value: "sender@example.com", disposition: "likely" }
    });
    const scan = await app.inject({ method: "POST", url: "/v1/email/scan", payload: {} });
    const decisions = await app.inject({
      method: "GET",
      url: "/v1/email/triage-decisions?outcome=no_action"
    });
    const proposals = await app.inject({ method: "GET", url: "/v1/email/proposals?status=proposed" });
    await app.close();

    expect(scan.statusCode).toBe(200);
    expect(ai.calls).toBe(1);
    expect(proposals.json().proposals).toHaveLength(0);
    expect(decisions.json().decisions[0]).toMatchObject({
      reason: "Informational only.",
      senderPreference: { disposition: "likely" }
    });
  });

  it("records a domain never rule as deterministic no-action without calling AI", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const ai = proposalAi();
    const app = buildApp({ ai, emailClient: fakeGmailClient() });
    await app.inject({
      method: "POST",
      url: "/v1/email/sender-preferences",
      payload: { matchType: "domain", value: "example.com", disposition: "never" }
    });
    const scan = await app.inject({ method: "POST", url: "/v1/email/scan", payload: {} });
    const decisions = await app.inject({
      method: "GET",
      url: "/v1/email/triage-decisions?outcome=no_action"
    });
    await app.close();

    expect(ai.calls).toBe(0);
    expect(scan.json().result).toMatchObject({ senderRuleExclusions: 1, noActionDecisions: 1 });
    expect(decisions.json().decisions[0]).toMatchObject({ reasonCode: "sender_preference_never" });
  });

  it("does not start a duplicate Gmail scan while one is running", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("GOG_KEYRING_PASSWORD", "test-password");
    const started = deferred();
    const release = deferred();
    let searchCount = 0;
    const app = buildApp({
      ai: proposalAi(),
      emailClient: {
        ...fakeGmailClient(),
        async searchMessagePage() {
          searchCount += 1;
          started.resolve();
          await release.promise;
          return { messages: [] };
        }
      }
    });

    const firstScan = app.inject({
      method: "POST",
      url: "/v1/email/scan",
      payload: {
        userId: "local-owner"
      }
    });
    await started.promise;
    const secondScan = await app.inject({
      method: "POST",
      url: "/v1/email/scan",
      payload: {
        userId: "local-owner"
      }
    });
    release.resolve();
    const firstScanResult = await firstScan;
    await app.close();

    expect(secondScan.statusCode).toBe(200);
    expect(secondScan.json()).toMatchObject({
      alreadyRunning: true,
      run: { status: "running" }
    });
    expect(firstScanResult.statusCode).toBe(200);
    expect(firstScanResult.json()).toMatchObject({
      result: {
        accountsScanned: 1,
        messagesSeen: 0
      }
    });
    expect(searchCount).toBe(1);
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

  it("creates proposal progress notes and checklist items when accepting concrete email hints", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const store = new InMemoryRyanStore();
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
      externalId: "msg-progress",
      title: "Tux rental follow-up"
    });
    const proposal = await store.upsertEmailActionProposal({
      userId: "local-owner",
      sourceId: source.id,
      providerAccountId: account.id,
      idempotencyKey: "gmail:progress",
      actionType: "task",
      title: "Get groomsman tuxedos reserved",
      metadata: {
        initialProgressNote: "emailed tux company",
        checklistItems: ["Confirm sizes", "Pay deposit"]
      }
    });
    const app = buildApp({
      store,
      ai: proposalAi(),
      emailClient: fakeGmailClient()
    });

    const accepted = await app.inject({
      method: "POST",
      url: `/v1/email/proposals/${proposal.id}/accept`,
      payload: {
        userId: "local-owner"
      }
    });
    await app.close();

    const itemId = accepted.json().item.id as string;
    expect(accepted.statusCode).toBe(200);
    expect(await store.listItemProgressNotes({ userId: "local-owner", itemId })).toEqual([
      expect.objectContaining({
        body: "emailed tux company"
      })
    ]);
    expect(await store.listItemChecklistItems({ userId: "local-owner", itemId })).toEqual([
      expect.objectContaining({
        title: "Confirm sizes",
        sortOrder: 0
      }),
      expect.objectContaining({
        title: "Pay deposit",
        sortOrder: 1
      })
    ]);
  });

  it("rejects a proposal when local-owner resolves to the stored owner UUID", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const resolvedUserId = "00000000-0000-4000-8000-000000000001";
    const store: RyanStore = new AliasOwnerStore("local-owner", resolvedUserId);
    const account = await store.upsertProviderAccount({
      userId: resolvedUserId,
      provider: "gmail",
      externalAccountId: "ryan@example.com",
      email: "ryan@example.com"
    });
    const source = await store.upsertExternalSource({
      userId: resolvedUserId,
      provider: "gmail",
      providerAccountId: account.id,
      externalId: "msg-resolved-owner",
      title: "Direct note"
    });
    const proposal = await store.upsertEmailActionProposal({
      userId: resolvedUserId,
      sourceId: source.id,
      providerAccountId: account.id,
      idempotencyKey: "gmail:resolved-owner-reject",
      actionType: "reply",
      title: "Reply to direct note"
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
    await app.close();

    expect(rejected.statusCode).toBe(200);
    expect(rejected.json()).toMatchObject({
      proposal: {
        status: "rejected"
      }
    });
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
        async searchMessagePage() {
          return { messages: [] };
        },
        async getThread() {
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
