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
      date: expect.any(String),
      items: [
        {
          title: "Review dashboard item list",
          status: "open"
        }
      ]
    });
  });

  it("returns a daily focus plan with suggested items", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const app = buildApp();
    await app.inject({
      method: "POST",
      url: "/v1/tools/item.create/invoke",
      payload: {
        input: {
          userId: "local-owner",
          title: "File court proposal",
          kind: "task",
          priority: "high",
          dueAt: "2026-05-27T17:00:00.000Z"
        }
      }
    });
    await app.inject({
      method: "POST",
      url: "/v1/tools/item.create/invoke",
      payload: {
        input: {
          userId: "local-owner",
          title: "Do laundry",
          kind: "task",
          priority: "normal"
        }
      }
    });

    const plan = await app.inject({
      method: "GET",
      url: "/v1/daily-plan?userId=local-owner&date=2026-05-27&timezone=UTC"
    });
    const saved = await app.inject({
      method: "POST",
      url: "/v1/daily-plan",
      payload: {
        userId: "local-owner",
        date: "2026-05-27",
        timezone: "UTC",
        response: "File court proposal",
        successCriteria: ["File court proposal"],
        selectedItemIds: [plan.json().suggestedItems[0].id]
      }
    });
    await app.close();

    expect(plan.statusCode).toBe(200);
    expect(plan.json()).toMatchObject({
      prompt: expect.stringContaining("make today count"),
      suggestedItems: expect.arrayContaining([
        expect.objectContaining({ title: "File court proposal" })
      ]),
      dueItems: expect.arrayContaining([
        expect.objectContaining({ title: "File court proposal" })
      ])
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().plan.response).toBe("File court proposal");
    expect(saved.json().plan.suggestionSource).toBe("user");
  });

  it("returns weekly recurrence progress and toggles day completion", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const app = buildApp();
    await app.inject({
      method: "POST",
      url: "/v1/tools/item.create/invoke",
      payload: {
        input: {
          userId: "local-owner",
          title: "Go to the gym",
          kind: "habit"
        }
      }
    });
    await app.inject({
      method: "POST",
      url: "/v1/tools/recurrence.setPolicy/invoke",
      payload: {
        input: {
          userId: "local-owner",
          itemRef: "Go to the gym",
          policy: {
            type: "target_frequency",
            targetCount: 5,
            targetWindowDays: 7,
            resetFromCompletion: true
          }
        }
      }
    });
    await app.inject({
      method: "POST",
      url: "/v1/tools/recurrence.recordEvent/invoke",
      payload: {
        input: {
          userId: "local-owner",
          recurrenceRef: "Go to the gym",
          eventType: "completed",
          occurredAt: "2026-05-26T12:00:00.000Z"
        }
      }
    });
    await app.inject({
      method: "POST",
      url: "/v1/tools/recurrence.recordEvent/invoke",
      payload: {
        input: {
          userId: "local-owner",
          recurrenceRef: "Go to the gym",
          eventType: "completed",
          occurredAt: "2026-05-27T12:00:00.000Z"
        }
      }
    });

    const listed = await app.inject({
      method: "GET",
      url: "/v1/items?userId=local-owner&date=2026-05-27&timezone=UTC"
    });
    const listedBody = listed.json() as {
      items: Array<{
        id: string;
        recurrence: {
          week: {
            completedCount: number;
            targetCount: number;
            days: Array<{ date: string; status: string }>;
          };
        };
      }>;
    };
    const item = listedBody.items[0];
    expect(item?.recurrence.week.completedCount).toBe(2);
    expect(item?.recurrence.week.targetCount).toBe(5);
    expect(item?.recurrence.week.days).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ date: "2026-05-26", status: "completed" }),
        expect.objectContaining({ date: "2026-05-27", status: "completed" })
      ])
    );

    const toggled = await app.inject({
      method: "POST",
      url: `/v1/items/${item?.id}/recurrence-days/2026-05-28`,
      payload: {
        userId: "local-owner",
        completed: true,
        timezone: "UTC"
      }
    });
    expect(toggled.statusCode).toBe(200);
    expect(toggled.json().item.recurrence.week.completedCount).toBe(3);

    const undone = await app.inject({
      method: "POST",
      url: `/v1/items/${item?.id}/recurrence-days/2026-05-28`,
      payload: {
        userId: "local-owner",
        completed: false,
        timezone: "UTC"
      }
    });
    expect(undone.statusCode).toBe(200);
    expect(undone.json().item.recurrence.week.completedCount).toBe(2);
    expect(undone.json().item.recurrence.week.days).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ date: "2026-05-28", status: "uncompleted" })
      ])
    );
    await app.close();
  });

  it("hides future minimum-interval items until the day before they are due", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const app = buildApp();
    await app.inject({
      method: "POST",
      url: "/v1/tools/item.create/invoke",
      payload: {
        input: {
          userId: "local-owner",
          title: "Take GLP-1 shot",
          kind: "habit"
        }
      }
    });
    await app.inject({
      method: "POST",
      url: "/v1/tools/item.create/invoke",
      payload: {
        input: {
          userId: "local-owner",
          title: "Review insurance bill",
          kind: "task",
          priority: "normal"
        }
      }
    });
    await app.inject({
      method: "POST",
      url: "/v1/tools/recurrence.setPolicy/invoke",
      payload: {
        input: {
          userId: "local-owner",
          itemRef: "Take GLP-1 shot",
          policy: {
            type: "minimum_interval",
            minimumIntervalDays: 7,
            resetFromCompletion: true
          }
        }
      }
    });
    await app.inject({
      method: "POST",
      url: "/v1/tools/recurrence.recordEvent/invoke",
      payload: {
        input: {
          userId: "local-owner",
          recurrenceRef: "Take GLP-1 shot",
          eventType: "completed",
          occurredAt: "2026-05-20T12:00:00.000Z"
        }
      }
    });

    const twoDaysBefore = await app.inject({
      method: "GET",
      url: "/v1/items?userId=local-owner&date=2026-05-25&timezone=UTC"
    });
    const hiddenIncluded = await app.inject({
      method: "GET",
      url: "/v1/items?userId=local-owner&date=2026-05-25&timezone=UTC&includeHidden=true"
    });
    const dayBefore = await app.inject({
      method: "GET",
      url: "/v1/items?userId=local-owner&date=2026-05-26&timezone=UTC"
    });
    await app.close();

    expect(twoDaysBefore.json().items.map((item: { title: string }) => item.title)).not.toContain(
      "Take GLP-1 shot"
    );
    expect(hiddenIncluded.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Take GLP-1 shot",
          hiddenUntil: "2026-05-26",
          prioritySignals: expect.arrayContaining(["hidden until 2026-05-26", "next due 2026-05-27"])
        })
      ])
    );
    expect(dayBefore.json().items.map((item: { title: string }) => item.title)).toEqual([
      "Review insurance bill",
      "Take GLP-1 shot"
    ]);
    expect(dayBefore.json().items[1].priorityScore).toBeLessThan(dayBefore.json().items[0].priorityScore);
  });

  it("orders target-frequency items by recency and target pressure", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const app = buildApp();
    for (const title of ["Go to the gym", "Call grandpa"]) {
      await app.inject({
        method: "POST",
        url: "/v1/tools/item.create/invoke",
        payload: {
          input: {
            userId: "local-owner",
            title,
            kind: "habit"
          }
        }
      });
    }
    await app.inject({
      method: "POST",
      url: "/v1/tools/recurrence.setPolicy/invoke",
      payload: {
        input: {
          userId: "local-owner",
          itemRef: "Go to the gym",
          policy: {
            type: "target_frequency",
            targetCount: 5,
            targetWindowDays: 7,
            resetFromCompletion: true
          }
        }
      }
    });
    await app.inject({
      method: "POST",
      url: "/v1/tools/recurrence.setPolicy/invoke",
      payload: {
        input: {
          userId: "local-owner",
          itemRef: "Call grandpa",
          policy: {
            type: "target_frequency",
            targetCount: 1,
            targetWindowDays: 7,
            resetFromCompletion: true
          }
        }
      }
    });
    await app.inject({
      method: "POST",
      url: "/v1/tools/recurrence.recordEvent/invoke",
      payload: {
        input: {
          userId: "local-owner",
          recurrenceRef: "Go to the gym",
          eventType: "completed",
          occurredAt: "2026-05-27T12:00:00.000Z"
        }
      }
    });
    await app.inject({
      method: "POST",
      url: "/v1/tools/recurrence.recordEvent/invoke",
      payload: {
        input: {
          userId: "local-owner",
          recurrenceRef: "Call grandpa",
          eventType: "completed",
          occurredAt: "2026-05-18T12:00:00.000Z"
        }
      }
    });

    const listed = await app.inject({
      method: "GET",
      url: "/v1/items?userId=local-owner&date=2026-05-27&timezone=UTC"
    });
    await app.close();

    const items = listed.json().items as Array<{
      title: string;
      priorityScore: number;
      prioritySignals: string[];
    }>;
    expect(items.map((item) => item.title)).toEqual(["Call grandpa", "Go to the gym"]);
    expect(items[0].priorityScore).toBeGreaterThan(items[1].priorityScore);
    expect(items[0].prioritySignals).toEqual(expect.arrayContaining(["9d since last"]));
    expect(items[1].prioritySignals).toEqual(expect.arrayContaining(["done today"]));
  });

  it("returns dashboard taxonomy labels for classified items", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const app = buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/v1/tools/item.create/invoke",
      payload: {
        input: {
          userId: "local-owner",
          title: "Review Method cash forecast",
          kind: "task",
          areaRef: "Finance",
          projectRef: "Method"
        }
      }
    });
    expect(created.statusCode).toBe(200);

    const taxonomy = await app.inject({
      method: "GET",
      url: "/v1/taxonomy?userId=local-owner"
    });
    expect(taxonomy.statusCode).toBe(200);
    expect(taxonomy.json()).toMatchObject({
      areas: [expect.objectContaining({ name: "Finance", icon: "landmark" })],
      projects: [expect.objectContaining({ name: "Method", areaId: expect.any(String) })]
    });

    const listed = await app.inject({
      method: "GET",
      url: "/v1/items?userId=local-owner"
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Review Method cash forecast",
          scope: expect.objectContaining({
            area: expect.objectContaining({ name: "Finance", icon: "landmark" }),
            project: expect.objectContaining({ name: "Method" })
          })
        })
      ])
    );
    await app.close();
  });

  it("keeps one-off tasks completed today visible until end of day", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const app = buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/v1/tools/item.create/invoke",
      payload: {
        input: {
          userId: "local-owner",
          title: "Pay parking ticket",
          kind: "task"
        }
      }
    });
    const itemId = created.json().data.item.id;

    const completed = await app.inject({
      method: "POST",
      url: `/v1/items/${itemId}/complete`,
      payload: {
        userId: "local-owner",
        completed: true,
        completedAt: "2026-05-27T16:00:00.000Z",
        timezone: "UTC"
      }
    });
    expect(completed.statusCode).toBe(200);

    const listed = await app.inject({
      method: "GET",
      url: "/v1/items?userId=local-owner&status=open,active,waiting&includeDoneToday=true&date=2026-05-27&timezone=UTC"
    });
    expect(listed.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: itemId,
          status: "done",
          completion: expect.objectContaining({ completedToday: true })
        })
      ])
    );

    const reopened = await app.inject({
      method: "POST",
      url: `/v1/items/${itemId}/complete`,
      payload: {
        userId: "local-owner",
        completed: false,
        timezone: "UTC"
      }
    });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json().item).toMatchObject({
      id: itemId,
      status: "open"
    });
    await app.close();
  });
});
