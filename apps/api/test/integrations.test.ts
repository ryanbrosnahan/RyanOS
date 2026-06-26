import type {
  AiProvider,
  AiProviderResult,
  AiProviderStatus,
  IncomingMessage,
  PublicToolDefinition
} from "@ryanos/ai";
import { InMemoryRyanStore } from "@ryanos/core";
import type { UUID } from "@ryanos/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";
import type { GmailClientLike } from "../src/email-triage.js";

class ReadyAiProvider implements AiProvider {
  readonly name = "codex-login";
  readonly mode = "codex-login";

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
    return {
      text: "ok",
      toolCalls: []
    };
  }
}

function gmailClient(accounts = [{ email: "ryan@example.com", externalAccountId: "ryan@example.com" }]): GmailClientLike {
  return {
    async doctor() {
      return {
        installed: true,
        ok: true,
        version: "gog v0.15.0"
      };
    },
    async listAccounts() {
      return accounts.map((account) => ({
        email: account.email,
        externalAccountId: account.externalAccountId,
        displayName: account.email,
        scopes: ["gmail"],
        status: "active",
        raw: account
      }));
    },
    async searchMessages() {
      return [];
    },
    async getMessage() {
      throw new Error("not used");
    }
  };
}

describe("integrations API", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns dev-local superadmin role and default-enabled integrations", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const app = buildApp({
      ai: new ReadyAiProvider(),
      emailClient: gmailClient()
    });

    const me = await app.inject({ method: "GET", url: "/v1/me" });
    const integrations = await app.inject({ method: "GET", url: "/v1/integrations" });
    await app.close();

    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({
      user: {
        role: "superadmin"
      }
    });
    expect(integrations.statusCode).toBe(200);
    expect(integrations.json()).toMatchObject({
      user: {
        role: "superadmin"
      },
      integrations: expect.arrayContaining([
        expect.objectContaining({ id: "ai", enabled: true }),
        expect.objectContaining({ id: "gmail", enabled: true }),
        expect.objectContaining({ id: "telegram", enabled: true })
      ])
    });
  });

  it("returns deployment summaries only for superadmins", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const store = new InMemoryRyanStore();
    await store.upsertProviderAccount({
      userId: "other-user" as UUID,
      provider: "gmail",
      externalAccountId: "other@example.com",
      email: "other@example.com",
      status: "active"
    });
    await store.upsertUserIntegrationSetting({
      userId: "other-user" as UUID,
      integrationId: "gmail",
      enabled: false
    });
    const superadminApp = buildApp({
      store,
      ai: new ReadyAiProvider(),
      emailClient: gmailClient()
    });

    const superadminResponse = await superadminApp.inject({
      method: "GET",
      url: "/v1/integrations"
    });
    await superadminApp.close();

    const userApp = buildApp({
      store,
      ai: new ReadyAiProvider(),
      emailClient: gmailClient(),
      devLocalRole: "user"
    });
    const userResponse = await userApp.inject({
      method: "GET",
      url: "/v1/integrations"
    });
    await userApp.close();

    expect(superadminResponse.statusCode).toBe(200);
    expect(superadminResponse.json()).toMatchObject({
      deployment: {
        providerAccounts: [
          {
            provider: "gmail",
            status: "active",
            accountCount: 1,
            userCount: 1
          }
        ],
        integrationSettings: [
          {
            integrationId: "gmail",
            enabled: false,
            userCount: 1
          }
        ]
      }
    });
    expect(userResponse.statusCode).toBe(200);
    expect(userResponse.json().deployment).toBeUndefined();
  });

  it("persists user integration toggles and blocks disabled Gmail scans", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const app = buildApp({
      ai: new ReadyAiProvider(),
      emailClient: gmailClient()
    });

    const update = await app.inject({
      method: "PATCH",
      url: "/v1/integrations/gmail/settings",
      payload: { enabled: false }
    });
    const integrations = await app.inject({ method: "GET", url: "/v1/integrations" });
    const scan = await app.inject({
      method: "POST",
      url: "/v1/email/scan",
      payload: {}
    });
    await app.close();

    expect(update.statusCode).toBe(200);
    expect(integrations.json().integrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "gmail",
          enabled: false,
          effectiveReady: false
        })
      ])
    );
    expect(scan.statusCode).toBe(409);
    expect(scan.json()).toMatchObject({
      error: "Gmail integration is disabled for this user."
    });
  });

  it("rejects superadmin-only Telegram token setup for normal users", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const app = buildApp({
      devLocalRole: "user",
      emailClient: gmailClient()
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/integrations/telegram/bot-token",
      payload: {
        token: "123456789:abcdefghijklmnopqrstuvwxyzABCDE"
      }
    });
    await app.close();

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: "Superadmin access is required."
    });
  });

  it("keeps raw setup diagnostics superadmin-only", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const app = buildApp({
      devLocalRole: "user",
      emailClient: gmailClient()
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/setup/status"
    });
    await app.close();

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: "Superadmin access is required."
    });
  });

  it("validates Telegram bot token shape before storage", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const app = buildApp({
      emailClient: gmailClient()
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/admin/integrations/telegram/bot-token",
      payload: {
        token: "not-a-token"
      }
    });
    await app.close();

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("bot-token shape");
  });

  it("links Telegram senders with a self-service link code", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    const store = new InMemoryRyanStore();
    const app = buildApp({
      store,
      ai: new ReadyAiProvider(),
      emailClient: gmailClient()
    });

    const link = await app.inject({
      method: "POST",
      url: "/v1/integrations/telegram/link-code",
      payload: {}
    });
    const code = link.json().code as string;
    const inbound = await app.inject({
      method: "POST",
      url: "/v1/inbound/telegram",
      payload: {
        update_id: 1,
        message: {
          message_id: 2,
          date: 1779857600,
          chat: { id: 123456, type: "private" },
          from: {
            id: 424242,
            is_bot: false,
            first_name: "Chrissy",
            username: "chrissy"
          },
          text: `/start ${code}`
        }
      }
    });
    const integrations = await app.inject({ method: "GET", url: "/v1/integrations" });
    await app.close();

    expect(link.statusCode).toBe(200);
    expect(inbound.statusCode).toBe(200);
    expect(inbound.json()).toMatchObject({
      status: "linked"
    });
    expect(integrations.json().integrations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "telegram",
          linkedAccounts: [
            expect.objectContaining({
              displayName: "Chrissy"
            })
          ]
        })
      ])
    );
  });
});
