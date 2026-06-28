import { afterEach, describe, expect, it, vi } from "vitest";
import { ScriptedAiProvider } from "@ryanos/ai";
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
          title: "Store Telegram bot token"
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

  it("runs an AI smoke probe without exposing tool execution", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const app = buildApp({
      ai: new ScriptedAiProvider([
        {
          matchText:
            "Setup check only: reply that the Codex bridge is working. Do not create tasks or use tools.",
          result: {
            text: "The Codex bridge is working.",
            toolCalls: []
          }
        }
      ])
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/ai/smoke",
      payload: {
        userId: "local-owner"
      }
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      interpreted: {
        text: "The Codex bridge is working.",
        toolCalls: []
      }
    });
  });

  it("uses the AI provider path to create recurrence state from a natural language message", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const text = "I want to change my bed sheets once a week. I changed them yesterday.";

    const app = buildApp({
      ai: new ScriptedAiProvider([
        {
          matchText: text,
          result: {
            text: "Recorded your weekly bed sheet habit.",
            toolCalls: [
              {
                name: "item.create",
                input: {
                  title: "Change bed sheets",
                  kind: "habit",
                  areaRef: "Home"
                }
              },
              {
                name: "recurrence.setPolicy",
                input: {
                  itemRef: "Change bed sheets",
                  policy: {
                    type: "completion_based",
                    intervalDays: 7,
                    resetFromCompletion: true
                  }
                }
              },
              {
                name: "recurrence.recordEvent",
                input: {
                  recurrenceRef: "Change bed sheets",
                  eventType: "completed",
                  occurredAt: "2026-05-26T12:00:00.000Z"
                }
              }
            ]
          }
        }
      ])
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/messages",
      payload: {
        provider: "web",
        chatId: "dashboard",
        userId: "local-owner",
        text,
        timestamp: "2026-05-27T14:00:00.000Z"
      }
    });
    const listed = await app.inject({
      method: "GET",
      url: "/v1/items?userId=local-owner&date=2026-05-27&timezone=UTC&includeHidden=true"
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().toolResults.map((result: { result: { status: string } }) => result.result.status)).toEqual([
      "applied",
      "applied",
      "applied"
    ]);
    expect(listed.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Change bed sheets",
          hiddenUntil: "2026-06-01",
          recurrence: expect.objectContaining({
            state: expect.objectContaining({
              lastCompletedAt: "2026-05-26T12:00:00.000Z",
              nextDueAt: "2026-06-02T12:00:00.000Z"
            })
          })
        })
      ])
    );
  });

  it("uses the AI provider path to add shopping-list items from a natural language message", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const text = "Add some items to my shopping list. I need envelopes, soap for my car";

    const app = buildApp({
      ai: new ScriptedAiProvider([
        {
          matchText: text,
          result: {
            text: "Added those to your shopping list.",
            toolCalls: [
              {
                name: "shopping.addItems",
                input: {
                  items: [
                    { name: "envelopes" },
                    { name: "soap for my car" }
                  ]
                }
              }
            ]
          }
        }
      ])
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/messages",
      payload: {
        provider: "web",
        chatId: "dashboard",
        userId: "local-owner",
        text,
        timestamp: "2026-06-20T21:48:10.000Z"
      }
    });
    const shopping = await app.inject({
      method: "GET",
      url: "/v1/shopping/list?userId=local-owner&suggestions=0"
    });
    const items = await app.inject({
      method: "GET",
      url: "/v1/items?userId=local-owner&includeHidden=true"
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json().toolResults).toEqual([
      expect.objectContaining({
        name: "shopping.addItems",
        result: expect.objectContaining({ status: "applied" })
      })
    ]);
    expect(shopping.json().items.map((item: { name: string }) => item.name).sort()).toEqual([
      "envelopes",
      "soap for my car"
    ].sort());
    expect(items.json().items).toEqual([]);
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
    expect(plan.json()).not.toHaveProperty("prompt");
    expect(plan.json()).toMatchObject({
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

  it("does not expose the retired daily prompt endpoint", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const app = buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/v1/daily-plan/prompt",
      payload: {
        userId: "local-owner"
      }
    });
    await app.close();

    expect(response.statusCode).toBe(404);
  });

  it("uses starred items as active daily focus instead of saved selected items", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const app = buildApp();
    const selectedCreated = await app.inject({
      method: "POST",
      url: "/v1/tools/item.create/invoke",
      payload: {
        input: {
          userId: "local-owner",
          title: "Old selected focus",
          kind: "task",
          priority: "normal"
        }
      }
    });
    const starredCreated = await app.inject({
      method: "POST",
      url: "/v1/tools/item.create/invoke",
      payload: {
        input: {
          userId: "local-owner",
          title: "Pinned focus item",
          kind: "task",
          priority: "low"
        }
      }
    });
    const selectedItemId = selectedCreated.json().data.item.id as string;
    const starredItemId = starredCreated.json().data.item.id as string;
    await app.inject({
      method: "POST",
      url: "/v1/daily-plan",
      payload: {
        userId: "local-owner",
        date: "2026-05-27",
        timezone: "UTC",
        selectedItemIds: [selectedItemId]
      }
    });
    const starred = await app.inject({
      method: "POST",
      url: `/v1/items/${starredItemId}/star`,
      payload: {
        userId: "local-owner",
        starred: true,
        starredAt: "2026-05-27T14:00:00.000Z",
        timezone: "UTC"
      }
    });
    const listed = await app.inject({
      method: "GET",
      url: "/v1/items?userId=local-owner&date=2026-05-27&timezone=UTC"
    });
    const plan = await app.inject({
      method: "GET",
      url: "/v1/daily-plan?userId=local-owner&date=2026-05-27&timezone=UTC"
    });
    await app.close();

    expect(starred.statusCode).toBe(200);
    expect(starred.json().item).toMatchObject({
      id: starredItemId,
      starred: true,
      starredAt: "2026-05-27T14:00:00.000Z"
    });
    expect(listed.json().items[0]).toMatchObject({
      id: starredItemId,
      starred: true
    });
    expect(plan.json().starredItems).toEqual([
      expect.objectContaining({
        id: starredItemId,
        title: "Pinned focus item",
        starred: true
      })
    ]);
    expect(plan.json().selectedItems).toEqual([
      expect.objectContaining({
        id: selectedItemId,
        title: "Old selected focus"
      })
    ]);
  });

  it("soft-deletes an item through the REST API and removes it from focus", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const app = buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/v1/tools/item.create/invoke",
      payload: {
        input: {
          userId: "local-owner",
          title: "Delete me",
          kind: "task"
        }
      }
    });
    const itemId = created.json().data.item.id as string;
    await app.inject({
      method: "POST",
      url: `/v1/items/${itemId}/star`,
      payload: {
        userId: "local-owner",
        starred: true,
        timezone: "UTC"
      }
    });

    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/items/${itemId}`,
      payload: {
        userId: "local-owner",
        timezone: "UTC",
        deletedAt: "2026-05-27T15:00:00.000Z"
      }
    });
    const listed = await app.inject({
      method: "GET",
      url: "/v1/items?userId=local-owner&date=2026-05-27&timezone=UTC"
    });
    const plan = await app.inject({
      method: "GET",
      url: "/v1/daily-plan?userId=local-owner&date=2026-05-27&timezone=UTC"
    });
    await app.close();

    expect(deleted.statusCode).toBe(200);
    expect(deleted.json().item).toMatchObject({
      id: itemId,
      starred: false,
      deletedAt: "2026-05-27T15:00:00.000Z"
    });
    expect(listed.json().items).toEqual([]);
    expect(plan.json().starredItems).toEqual([]);
  });

  it("returns rolling seven-day recurrence progress and toggles day completion", async () => {
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
          occurredAt: "2026-05-22T12:00:00.000Z"
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
            startDate: string;
            endDate: string;
            completedCount: number;
            targetCount: number;
            days: Array<{ date: string; status: string }>;
          };
        };
      }>;
    };
    const item = listedBody.items[0];
    expect(item?.recurrence.week.startDate).toBe("2026-05-21");
    expect(item?.recurrence.week.endDate).toBe("2026-05-27");
    expect(item?.recurrence.week.days.map((day) => day.date)).toEqual([
      "2026-05-21",
      "2026-05-22",
      "2026-05-23",
      "2026-05-24",
      "2026-05-25",
      "2026-05-26",
      "2026-05-27"
    ]);
    expect(item?.recurrence.week.completedCount).toBe(3);
    expect(item?.recurrence.week.targetCount).toBe(5);
    expect(item?.recurrence.week.days).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ date: "2026-05-22", status: "completed" }),
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
    expect(toggled.json().item.recurrence.week.completedCount).toBe(4);

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
    expect(undone.json().item.recurrence.week.completedCount).toBe(3);
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

  it("allows dashboard day toggles to intentionally complete minimum-interval items early", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const app = buildApp();
    const created = await app.inject({
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
    const itemId = created.json().data.item.id;
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

    const blocked = await app.inject({
      method: "POST",
      url: `/v1/items/${itemId}/recurrence-days/2026-05-26`,
      payload: {
        userId: "local-owner",
        completed: true,
        timezone: "UTC",
        referenceDate: "2026-05-26"
      }
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().result.status).toBe("needs_confirmation");

    const completedEarly = await app.inject({
      method: "POST",
      url: `/v1/items/${itemId}/recurrence-days/2026-05-26`,
      payload: {
        userId: "local-owner",
        completed: true,
        allowEarly: true,
        timezone: "UTC",
        referenceDate: "2026-05-26"
      }
    });
    await app.close();

    expect(completedEarly.statusCode).toBe(200);
    expect(completedEarly.json().result.status).toBe("applied");
    expect(completedEarly.json().item.recurrence.week.days).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ date: "2026-05-26", status: "completed" })
      ])
    );
    expect(completedEarly.json().item.recurrence.state.nextDueAt).toBe("2026-06-02T12:00:00.000Z");
  });

  it("exposes fixed-schedule cron cadence to dashboard recurrence payloads", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const app = buildApp();
    await app.inject({
      method: "POST",
      url: "/v1/tools/item.create/invoke",
      payload: {
        input: {
          userId: "local-owner",
          title: "Pay the HOA",
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
          itemRef: "Pay the HOA",
          policy: {
            type: "fixed_schedule",
            cron: "0 9 1 * *",
            resetFromCompletion: false
          }
        }
      }
    });

    const listed = await app.inject({
      method: "GET",
      url: "/v1/items?userId=local-owner&includeHidden=true&timezone=UTC"
    });
    await app.close();

    const item = listed.json().items.find((candidate: { title: string }) => candidate.title === "Pay the HOA");
    expect(item?.recurrence.policy).toMatchObject({
      type: "fixed_schedule",
      cron: "0 9 1 * *"
    });
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

  it("returns compact mobile widget items and toggles normal tasks", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const app = buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/v1/tools/item.create/invoke",
      payload: {
        input: {
          userId: "local-owner",
          title: "Buy coffee beans",
          kind: "task",
          priority: "high",
          dueAt: "2026-05-27T17:00:00.000Z"
        }
      }
    });
    const itemId = created.json().data.item.id as string;
    const secondCreated = await app.inject({
      method: "POST",
      url: "/v1/tools/item.create/invoke",
      payload: {
        input: {
          userId: "local-owner",
          title: "Write morning notes",
          kind: "task",
          priority: "normal"
        }
      }
    });
    const secondItemId = secondCreated.json().data.item.id as string;

    const listed = await app.inject({
      method: "GET",
      url: "/v1/mobile/widget-items?userId=local-owner&date=2026-05-27&timezone=UTC"
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({
      date: "2026-05-27",
      timezone: "UTC",
      generatedAt: expect.any(String)
    });
    expect(listed.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: itemId,
          title: "Buy coffee beans",
          checked: false,
          priority: "high",
          dueAt: "2026-05-27T17:00:00.000Z",
          secondaryText: "2026-05-27",
          action: {
            type: "item_complete",
            itemId
          }
        }),
        expect.objectContaining({
          id: secondItemId,
          title: "Write morning notes",
          checked: false
        })
      ])
    );

    const completed = await app.inject({
      method: "POST",
      url: `/v1/mobile/items/${itemId}/toggle`,
      payload: {
        userId: "local-owner",
        completed: true,
        date: "2026-05-27",
        timezone: "UTC"
      }
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json().item).toMatchObject({
      id: itemId,
      checked: true,
      status: "done"
    });
    const listedAfterComplete = await app.inject({
      method: "GET",
      url: "/v1/mobile/widget-items?userId=local-owner&date=2026-05-27&timezone=UTC"
    });
    expect(listedAfterComplete.json().items.map((item: { id: string }) => item.id)).toEqual([
      secondItemId,
      itemId
    ]);
    expect(listedAfterComplete.json().items[1]).toMatchObject({
      id: itemId,
      checked: true,
      status: "done"
    });

    const reopened = await app.inject({
      method: "POST",
      url: `/v1/mobile/items/${itemId}/toggle`,
      payload: {
        userId: "local-owner",
        completed: false,
        date: "2026-05-27",
        timezone: "UTC"
      }
    });
    await app.close();

    expect(reopened.statusCode).toBe(200);
    expect(reopened.json().item).toMatchObject({
      id: itemId,
      checked: false,
      status: "open"
    });
  });

  it("exposes task progress notes and checklist details through item and widget APIs", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const app = buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/v1/tools/item.create/invoke",
      payload: {
        input: {
          userId: "local-owner",
          title: "Reserve tuxedos",
          kind: "task",
          priority: "high"
        }
      }
    });
    const itemId = created.json().data.item.id as string;

    const progress = await app.inject({
      method: "POST",
      url: `/v1/items/${itemId}/progress-notes`,
      payload: {
        userId: "local-owner",
        timezone: "UTC",
        body: "emailed tux company",
        occurredAt: "2026-06-24T15:00:00.000Z"
      }
    });
    const checklist = await app.inject({
      method: "POST",
      url: `/v1/items/${itemId}/checklist-items`,
      payload: {
        userId: "local-owner",
        timezone: "UTC",
        title: "Confirm groomsman sizes"
      }
    });
    const listed = await app.inject({
      method: "GET",
      url: "/v1/items?userId=local-owner&date=2026-06-24&timezone=UTC"
    });
    const details = await app.inject({
      method: "GET",
      url: `/v1/items/${itemId}/details?userId=local-owner&date=2026-06-24&timezone=UTC`
    });
    const checklistItemId = details.json().checklistItems[0].id as string;
    const widget = await app.inject({
      method: "GET",
      url: "/v1/mobile/widget-items?userId=local-owner&date=2026-06-24&timezone=UTC"
    });
    const toggled = await app.inject({
      method: "POST",
      url: `/v1/mobile/items/${itemId}/checklist-items/${checklistItemId}/toggle`,
      payload: {
        userId: "local-owner",
        timezone: "UTC",
        checked: true,
        toggle: false
      }
    });
    await app.close();

    expect(progress.statusCode).toBe(200);
    expect(checklist.statusCode).toBe(200);
    expect(listed.json().items[0]).toMatchObject({
      id: itemId,
      progress: {
        count: 1,
        latest: expect.objectContaining({
          body: "emailed tux company"
        })
      },
      checklist: {
        total: 1,
        completed: 0
      }
    });
    expect(details.json()).toMatchObject({
      progressNotes: [
        expect.objectContaining({
          body: "emailed tux company"
        })
      ],
      checklistItems: [
        expect.objectContaining({
          title: "Confirm groomsman sizes",
          checked: false
        })
      ]
    });
    expect(widget.json().items[0]).toMatchObject({
      id: itemId,
      progress: {
        count: 1,
        latest: [
          expect.objectContaining({
            body: "emailed tux company"
          })
        ]
      },
      checklist: {
        total: 1,
        completed: 0,
        items: [
          expect.objectContaining({
            id: checklistItemId,
            checked: false
          })
        ]
      }
    });
    expect(toggled.statusCode).toBe(200);
    expect(toggled.json().item).toMatchObject({
      id: itemId,
      checklist: {
        total: 1,
        completed: 1,
        items: [
          expect.objectContaining({
            id: checklistItemId,
            checked: true
          })
        ]
      }
    });
  });

  it("sorts starred mobile widget items before higher-priority unstarred items", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const app = buildApp();
    const urgentCreated = await app.inject({
      method: "POST",
      url: "/v1/tools/item.create/invoke",
      payload: {
        input: {
          userId: "local-owner",
          title: "Urgent unstarred",
          kind: "task",
          priority: "urgent"
        }
      }
    });
    const starredCreated = await app.inject({
      method: "POST",
      url: "/v1/tools/item.create/invoke",
      payload: {
        input: {
          userId: "local-owner",
          title: "Normal starred",
          kind: "task",
          priority: "normal"
        }
      }
    });
    const urgentItemId = urgentCreated.json().data.item.id as string;
    const starredItemId = starredCreated.json().data.item.id as string;
    await app.inject({
      method: "POST",
      url: `/v1/items/${starredItemId}/star`,
      payload: {
        userId: "local-owner",
        starred: true,
        starredAt: "2026-05-27T14:00:00.000Z",
        timezone: "UTC"
      }
    });

    const listed = await app.inject({
      method: "GET",
      url: "/v1/mobile/widget-items?userId=local-owner&date=2026-05-27&timezone=UTC"
    });
    await app.close();

    expect(listed.statusCode).toBe(200);
    expect(listed.json().items.map((item: { id: string }) => item.id)).toEqual([
      starredItemId,
      urgentItemId
    ]);
    expect(listed.json().items[0]).toMatchObject({
      id: starredItemId,
      starred: true,
      starredAt: "2026-05-27T14:00:00.000Z"
    });
  });

  it("creates mobile items and returns a refreshed widget payload", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const app = buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/v1/mobile/items",
      payload: {
        userId: "local-owner",
        title: "Text Mom back",
        kind: "task",
        priority: "normal",
        date: "2026-05-27",
        timezone: "UTC"
      }
    });
    await app.close();

    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({
      result: {
        status: "applied"
      },
      item: {
        title: "Text Mom back",
        checked: false,
        action: {
          type: "item_complete"
        }
      },
      widget: {
        date: "2026-05-27",
        items: [
          expect.objectContaining({
            title: "Text Mom back"
          })
        ]
      }
    });
  });

  it("returns mobile widget area and project scope metadata", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const app = buildApp();
    const created = await app.inject({
      method: "POST",
      url: "/v1/tools/item.create/invoke",
      payload: {
        input: {
          userId: "local-owner",
          title: "Fix the sink",
          kind: "task",
          priority: "normal",
          areaRef: "Home",
          projectRef: "Repairs"
        }
      }
    });
    const itemId = created.json().data.item.id as string;

    const listed = await app.inject({
      method: "GET",
      url: "/v1/mobile/widget-items?userId=local-owner&date=2026-05-27&timezone=UTC"
    });
    await app.close();

    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toEqual([
      expect.objectContaining({
        id: itemId,
        title: "Fix the sink",
        scope: {
          area: expect.objectContaining({
            name: "Home",
            icon: "home",
            color: "amber"
          }),
          project: expect.objectContaining({
            name: "Repairs",
            icon: "folder-kanban",
            color: "stone"
          })
        }
      })
    ]);
  });

  it("returns more than eight open mobile widget items by default", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const app = buildApp();
    for (let index = 1; index <= 12; index += 1) {
      await app.inject({
        method: "POST",
        url: "/v1/tools/item.create/invoke",
        payload: {
          input: {
            userId: "local-owner",
            title: `Widget task ${String(index).padStart(2, "0")}`,
            kind: "task",
            priority: "normal"
          }
        }
      });
    }

    const listed = await app.inject({
      method: "GET",
      url: "/v1/mobile/widget-items?userId=local-owner&date=2026-05-27&timezone=UTC"
    });
    const limited = await app.inject({
      method: "GET",
      url: "/v1/mobile/widget-items?userId=local-owner&date=2026-05-27&timezone=UTC&limit=9"
    });
    await app.close();

    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toHaveLength(12);
    expect(listed.json().items.map((item: { title: string }) => item.title)).toEqual(
      expect.arrayContaining(["Widget task 01", "Widget task 12"])
    );
    expect(limited.json().items).toHaveLength(9);
  });

  it("hides future recurring mobile widget items until the configured lead window", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const app = buildApp();
    const created = await app.inject({
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
    const itemId = created.json().data.item.id as string;
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

    const listed = await app.inject({
      method: "GET",
      url: "/v1/mobile/widget-items?userId=local-owner&date=2026-05-25&timezone=UTC"
    });
    const listedWithTwoDayLead = await app.inject({
      method: "GET",
      url: "/v1/mobile/widget-items?userId=local-owner&date=2026-05-25&timezone=UTC&recurrenceLeadDays=2"
    });
    await app.close();

    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toEqual([]);
    expect(listedWithTwoDayLead.statusCode).toBe(200);
    expect(listedWithTwoDayLead.json().items).toEqual([
      expect.objectContaining({
        id: itemId,
        title: "Take GLP-1 shot",
        checked: false,
        prioritySignals: expect.arrayContaining(["hidden until 2026-05-26", "next due 2026-05-27"]),
        action: {
          type: "recurrence_day",
          itemId,
          date: "2026-05-25",
          allowEarly: true
        },
        recurrence: expect.objectContaining({
          summary: "1/1",
          intendedDate: "2026-05-27",
          nextDueAt: "2026-05-27T12:00:00.000Z",
          lastDoneLabel: "last 5d ago",
          days: expect.arrayContaining([
            expect.objectContaining({
              date: "2026-05-20",
              status: "completed",
              allowEarly: true,
              isToday: false,
              isIntended: false
            }),
            expect.objectContaining({
              date: "2026-05-25",
              status: "none",
              allowEarly: true,
              isToday: true,
              isIntended: false
            })
          ])
        })
      })
    ]);
  });

  it("shows starred future recurring items and clears focus after completion", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const app = buildApp();
    const created = await app.inject({
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
    const itemId = created.json().data.item.id as string;
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
    await app.inject({
      method: "POST",
      url: `/v1/items/${itemId}/star`,
      payload: {
        userId: "local-owner",
        starred: true,
        starredAt: "2026-05-25T08:00:00.000Z",
        timezone: "UTC"
      }
    });

    const listed = await app.inject({
      method: "GET",
      url: "/v1/mobile/widget-items?userId=local-owner&date=2026-05-25&timezone=UTC"
    });
    const completed = await app.inject({
      method: "POST",
      url: `/v1/items/${itemId}/recurrence-days/2026-05-25`,
      payload: {
        userId: "local-owner",
        completed: true,
        allowEarly: true,
        timezone: "UTC",
        referenceDate: "2026-05-25"
      }
    });
    const plan = await app.inject({
      method: "GET",
      url: "/v1/daily-plan?userId=local-owner&date=2026-05-25&timezone=UTC"
    });
    await app.close();

    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toEqual([
      expect.objectContaining({
        id: itemId,
        title: "Take GLP-1 shot",
        starred: true,
        prioritySignals: expect.arrayContaining(["hidden until 2026-05-26", "next due 2026-05-27"])
      })
    ]);
    expect(completed.statusCode).toBe(200);
    expect(completed.json().item).toMatchObject({
      id: itemId,
      starred: false
    });
    expect(plan.json().starredItems).toEqual([]);
  });

  it("maps recurring mobile widget items to recurrence-day toggles", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const app = buildApp();
    const created = await app.inject({
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
    const itemId = created.json().data.item.id as string;
    await app.inject({
      method: "POST",
      url: "/v1/tools/recurrence.setPolicy/invoke",
      payload: {
        input: {
          userId: "local-owner",
          itemRef: "Go to the gym",
          policy: {
            type: "target_frequency",
            targetCount: 3,
            targetWindowDays: 7,
            resetFromCompletion: true
          }
        }
      }
    });

    const listed = await app.inject({
      method: "GET",
      url: "/v1/mobile/widget-items?userId=local-owner&date=2026-05-27&timezone=UTC"
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().items).toEqual([
      expect.objectContaining({
        id: itemId,
        title: "Go to the gym",
        checked: false,
        recurrence: expect.objectContaining({
          summary: "0/3",
          days: expect.arrayContaining([
            expect.objectContaining({
              date: "2026-05-27",
              weekday: "Wed",
              status: "none",
              allowEarly: false,
              isToday: true,
              isIntended: false
            })
          ])
        }),
        action: {
          type: "recurrence_day",
          itemId,
          date: "2026-05-27",
          allowEarly: false
        }
      })
    ]);

    const completed = await app.inject({
      method: "POST",
      url: `/v1/mobile/items/${itemId}/toggle`,
      payload: {
        userId: "local-owner",
        completed: true,
        date: "2026-05-27",
        timezone: "UTC"
      }
    });
    const listedAfterComplete = await app.inject({
      method: "GET",
      url: "/v1/mobile/widget-items?userId=local-owner&date=2026-05-27&timezone=UTC"
    });
    const toggledFromStaleWidget = await app.inject({
      method: "POST",
      url: `/v1/mobile/items/${itemId}/toggle`,
      payload: {
        userId: "local-owner",
        completed: true,
        toggle: true,
        date: "2026-05-27",
        timezone: "UTC"
      }
    });
    const listedAfterStaleToggle = await app.inject({
      method: "GET",
      url: "/v1/mobile/widget-items?userId=local-owner&date=2026-05-27&timezone=UTC"
    });
    await app.close();

    expect(completed.statusCode).toBe(200);
    expect(completed.json().item).toMatchObject({
      id: itemId,
      checked: true,
      status: "open",
      action: {
        type: "recurrence_day",
        date: "2026-05-27"
      }
    });
    expect(listedAfterComplete.statusCode).toBe(200);
    expect(listedAfterComplete.json().items).toEqual([
      expect.objectContaining({
        id: itemId,
        checked: true,
        status: "open",
        recurrence: expect.objectContaining({
          summary: "1/3",
          days: expect.arrayContaining([
            expect.objectContaining({
              date: "2026-05-27",
              status: "completed",
              isToday: true
            })
          ])
        })
      })
    ]);
    expect(toggledFromStaleWidget.statusCode).toBe(200);
    expect(toggledFromStaleWidget.json().item).toMatchObject({
      id: itemId,
      checked: false,
      status: "open"
    });
    expect(listedAfterStaleToggle.statusCode).toBe(200);
    expect(listedAfterStaleToggle.json().items).toEqual([
      expect.objectContaining({
        id: itemId,
        checked: false,
        recurrence: expect.objectContaining({
          summary: "0/3",
          days: expect.arrayContaining([
            expect.objectContaining({
              date: "2026-05-27",
              status: "uncompleted",
              isToday: true
            })
          ])
        })
      })
    ]);
  });
});
