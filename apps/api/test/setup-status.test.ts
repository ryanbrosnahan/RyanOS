import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.js";

describe("setup status", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports human setup actions for disabled AI and unconfigured Telegram", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("RYANOS_AI_PROVIDER", "none");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubEnv("TELEGRAM_ALLOWED_USER_IDS", "");
    vi.stubEnv("RYANOS_MASTER_KEY_FILE", "/tmp/ryanos-test-missing-master-key");

    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/v1/setup/status"
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      ai: { id: string; setupRequired: boolean };
      integrations: Array<{
        id: string;
        setupRequired: boolean;
        setupActions: Array<{ id: string; title: string }>;
      }>;
    };

    expect(body.ai).toMatchObject({
      id: "ai",
      setupRequired: false
    });
    expect(body.integrations[0]).toMatchObject({
      id: "telegram",
      setupRequired: true
    });
    expect(body.integrations[0]?.setupActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "telegram-bot-token",
          title: "Import Telegram bot token into encrypted DB"
        })
      ])
    );
  });

  it("treats TELEGRAM_BOT_TOKEN as a ready fallback but asks for DB migration", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "123456789:abcdefghijklmnopqrstuvwxyzABCDE");
    vi.stubEnv("TELEGRAM_ALLOWED_USER_IDS", "123");
    vi.stubEnv("RYANOS_MASTER_KEY_FILE", "/tmp/ryanos-test-missing-master-key");

    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/v1/setup/status"
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      integrations: Array<{
        ready: boolean;
        setupActions: Array<{ id: string; blocking: boolean }>;
      }>;
    };

    expect(body.integrations[0]).toMatchObject({
      ready: true
    });
    expect(body.integrations[0]?.setupActions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "telegram-env-token-migration",
          blocking: false
        })
      ])
    );
  });

  it("allows the configured local web origin to read setup status", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("RYANOS_CORS_ORIGINS", "http://localhost:3100");

    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/v1/setup/status",
      headers: {
        origin: "http://localhost:3100"
      }
    });
    const preflight = await app.inject({
      method: "OPTIONS",
      url: "/v1/setup/status",
      headers: {
        origin: "http://localhost:3100",
        "access-control-request-headers": "content-type"
      }
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:3100");
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-methods"]).toContain("GET");
  });

  it("returns an empty message history when persistence is disabled", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const app = buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/v1/messages?provider=web&chatId=dashboard&userId=local-owner"
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ messages: [] });
  });

  it("lists dashboard items from the active store", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const app = buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/v1/tools/item.create/invoke",
      payload: {
        input: {
          userId: "local-owner",
          title: "Review dashboard item list",
          kind: "task"
        }
      }
    });
    const listed = await app.inject({
      method: "GET",
      url: "/v1/items?userId=local-owner"
    });
    await app.close();

    expect(created.statusCode).toBe(200);
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({
      items: [
        {
          title: "Review dashboard item list",
          status: "open"
        }
      ]
    });
  });
});
