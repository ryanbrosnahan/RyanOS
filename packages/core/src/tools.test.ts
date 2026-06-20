import { describe, expect, it, vi } from "vitest";
import { InMemoryRyanStore } from "./in-memory-store.js";
import { createCoreToolRegistry } from "./tools.js";

describe("core tools", () => {
  it("publishes safety metadata for AI-callable tools", () => {
    const tools = createCoreToolRegistry(new InMemoryRyanStore());
    const itemCreate = tools.list().find((tool) => tool.name === "item.create");
    const recurrenceRecord = tools
      .list()
      .find((tool) => tool.name === "recurrence.recordEvent");
    const recurrenceSet = tools
      .list()
      .find((tool) => tool.name === "recurrence.setPolicy");
    const shoppingAdd = tools
      .list()
      .find((tool) => tool.name === "shopping.addItems");

    expect(itemCreate?.metadata).toMatchObject({
      sideEffect: "state_write",
      confirmation: "not_required",
      retrySafety: "safe_with_idempotency_key"
    });
    expect(recurrenceRecord?.metadata).toMatchObject({
      sideEffect: "state_write",
      confirmation: "low_confidence",
      retrySafety: "safe_with_idempotency_key"
    });
    expect(shoppingAdd?.metadata).toMatchObject({
      sideEffect: "state_write",
      confirmation: "not_required",
      retrySafety: "safe_with_idempotency_key"
    });
    expect(itemCreate?.inputSchema).toMatchObject({
      properties: {
        kind: {
          enum: ["task", "reminder", "decision", "note", "waiting", "habit", "opportunity_action", "other"]
        }
      }
    });
    expect(recurrenceRecord?.inputSchema).toMatchObject({
      properties: {
        recurrenceRef: { type: "string" },
        eventType: {
          enum: ["completed", "uncompleted", "skipped", "missed", "deferred"]
        }
      },
      required: expect.arrayContaining(["recurrenceRef", "eventType"])
    });
    expect(recurrenceSet?.inputSchema).toMatchObject({
      properties: {
        policy: {
          properties: {
            type: {
              enum: ["completion_based", "fixed_schedule", "minimum_interval", "target_frequency", "opportunistic"]
            }
          }
        }
      }
    });
    expect(shoppingAdd?.inputSchema).toMatchObject({
      properties: {
        items: {
          type: "array"
        }
      },
      required: expect.arrayContaining(["items"])
    });
  });

  it("adds shopping-list items without creating task items", async () => {
    const store = new InMemoryRyanStore();
    const tools = createCoreToolRegistry(store);

    const added = await tools.execute("shopping.addItems", {
      userId: "user-1",
      items: [
        { name: "envelopes" },
        { name: "soap for my car" }
      ],
      sourceMessageId: "msg-shopping"
    });

    expect(added.status).toBe("applied");
    expect(store.items.size).toBe(0);
    expect([...store.shoppingListItems.values()].map((item) => item.name)).toEqual([
      "envelopes",
      "soap for my car"
    ]);
    expect([...store.shoppingListItems.values()].map((item) => item.category)).toEqual([
      "miscellaneous",
      "household good"
    ]);
    expect(store.auditLogs.at(-1)).toMatchObject({
      action: "shopping.addItems",
      toolName: "shopping.addItems",
      sourceMessageId: "msg-shopping"
    });
  });

  it("reopens a lingering checked shopping-list item when it is added again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-20T12:00:00.000Z"));
    try {
      const store = new InMemoryRyanStore();
      const tools = createCoreToolRegistry(store);
      const list = await store.getDefaultShoppingList("user-1");
      const existing = await store.createShoppingItem({
        userId: "user-1",
        listId: list.id,
        name: "Toothpaste",
        normalizedName: "toothpaste",
        category: "personal care",
        checkedAt: "2026-06-20T10:00:00.000Z",
        source: "android"
      });

      const added = await tools.execute("shopping.addItems", {
        userId: "user-1",
        items: [{ name: "toothpaste", quantity: "2" }]
      });

      expect(added.status).toBe("applied");
      expect(store.shoppingListItems.size).toBe(1);
      const updated = store.shoppingListItems.get(existing.id);
      expect(updated?.checkedAt).toBeUndefined();
      expect(updated?.quantity).toBe("2");
      expect(updated?.source).toBe("chat");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects shopping-list requests that are accidentally routed to item.create", async () => {
    const store = new InMemoryRyanStore();
    const tools = createCoreToolRegistry(store);

    const created = await tools.execute("item.create", {
      userId: "user-1",
      title: "Buy envelopes",
      kind: "task",
      projectRef: "Shopping list"
    });

    expect(created.status).toBe("rejected");
    expect(created.messageForUser).toContain("shopping.addItems");
    expect(store.items.size).toBe(0);
  });

  it("creates and completes an item through typed tool calls", async () => {
    const store = new InMemoryRyanStore();
    const tools = createCoreToolRegistry(store);

    const created = await tools.execute("item.create", {
      userId: "user-1",
      title: "Change sheets",
      kind: "task",
      sourceMessageId: "msg-1",
      idempotencyKey: "msg-1:item.create"
    });

    expect(created.status).toBe("applied");
    expect(store.items.size).toBe(1);

    const completed = await tools.execute("item.complete", {
      userId: "user-1",
      itemRef: "Change sheets",
      completedAt: "2026-05-23T15:00:00.000Z",
      sourceMessageId: "msg-2",
      idempotencyKey: "msg-2:item.complete"
    });

    expect(completed.status).toBe("applied");
    expect([...store.items.values()][0]?.status).toBe("done");
    expect(store.auditLogs.length).toBe(2);
  });

  it("defaults one-off tasks to a two-week due date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T14:00:00.000Z"));
    try {
      const store = new InMemoryRyanStore();
      const tools = createCoreToolRegistry(store);

      const created = await tools.execute("item.create", {
        userId: "user-1",
        title: "Schedule dentist",
        kind: "task"
      });

      expect(created.status).toBe("applied");
      const item = [...store.items.values()][0];
      expect(item?.dueAt).toBe("2026-06-11T14:00:00.000Z");
      expect(item?.metadata).toMatchObject({
        defaultDueAt: true,
        defaultDueDays: 14
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears a default one-off due date when an item becomes recurring", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T14:00:00.000Z"));
    try {
      const store = new InMemoryRyanStore();
      const tools = createCoreToolRegistry(store);

      await tools.execute("item.create", {
        userId: "user-1",
        title: "Change sheets",
        kind: "task"
      });
      const recurrent = await tools.execute("recurrence.setPolicy", {
        userId: "user-1",
        itemRef: "Change sheets",
        policy: {
          type: "completion_based",
          intervalDays: 7,
          resetFromCompletion: true
        }
      });

      expect(recurrent.status).toBe("applied");
      const item = [...store.items.values()][0];
      expect(item?.dueAt).toBeUndefined();
      expect(item?.metadata).toMatchObject({
        defaultDueAt: false,
        defaultDueClearedForRecurrenceAt: "2026-05-28T14:00:00.000Z"
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("searches and updates an item through typed tool calls", async () => {
    const store = new InMemoryRyanStore();
    const tools = createCoreToolRegistry(store);

    await tools.execute("item.create", {
      userId: "user-1",
      title: "Review RFP shortlist",
      kind: "task"
    });

    const searched = await tools.execute("item.search", {
      userId: "user-1",
      query: "RFP shortlist"
    });
    expect(searched.status).toBe("applied");
    expect((searched.data as { matches: unknown[] }).matches).toHaveLength(1);

    const updated = await tools.execute("item.update", {
      userId: "user-1",
      itemRef: "RFP shortlist",
      patch: {
        kind: "habit",
        priority: "high",
        bodyAppend: "Check due date and next action."
      }
    });

    expect(updated.status).toBe("applied");
    const item = [...store.items.values()][0];
    expect(item?.kind).toBe("habit");
    expect(item?.priority).toBe("high");
    expect(item?.body).toContain("Check due date");
    expect(store.itemEvents.filter((event) => event.eventType === "updated")).toHaveLength(1);
  });

  it("creates taxonomy and classifies items by area and project", async () => {
    const store = new InMemoryRyanStore();
    const tools = createCoreToolRegistry(store);

    const created = await tools.execute("item.create", {
      userId: "user-1",
      title: "Find new court RFPs",
      kind: "opportunity_action",
      areaRef: "Work",
      projectRef: "Legal software"
    });

    expect(created.status).toBe("applied");
    expect(store.areas.size).toBe(1);
    expect(store.projects.size).toBe(1);
    const item = [...store.items.values()][0];
    const area = [...store.areas.values()][0];
    const project = [...store.projects.values()][0];
    expect(item?.areaId).toBe(area?.id);
    expect(item?.projectId).toBe(project?.id);
    expect(project?.areaId).toBe(area?.id);

    await tools.execute("item.create", {
      userId: "user-1",
      title: "Go to the gym",
      kind: "habit"
    });
    const classified = await tools.execute("item.classify", {
      userId: "user-1",
      itemRef: "Go to the gym",
      areaRef: "Health"
    });

    expect(classified.status).toBe("applied");
    const gym = [...store.items.values()].find((candidate) => candidate.title === "Go to the gym");
    const health = [...store.areas.values()].find((candidate) => candidate.name === "Health");
    expect(gym?.areaId).toBe(health?.id);
  });

  it("stores a daily focus plan with selected item refs", async () => {
    const store = new InMemoryRyanStore();
    const tools = createCoreToolRegistry(store);

    await tools.execute("item.create", {
      userId: "user-1",
      title: "Send court RFP follow-up",
      kind: "task",
      priority: "high"
    });
    await tools.execute("item.create", {
      userId: "user-1",
      title: "Do laundry",
      kind: "task",
      priority: "normal"
    });

    const planned = await tools.execute("daily_plan.upsert", {
      userId: "user-1",
      dateKey: "2026-05-27",
      timezone: "America/Chicago",
      prompt: "Which outcomes would make today a win?",
      response: "Send the follow-up\nDo laundry",
      successCriteria: ["Send the follow-up", "Do laundry"],
      selectedItemRefs: ["Send court RFP follow-up", "Do laundry"],
      suggestedItemRefs: ["Send court RFP follow-up"],
      suggestionSource: "ai"
    });

    expect(planned.status).toBe("applied");
    const plan = await store.getDailyPlan("user-1", "2026-05-27");
    expect(plan?.response).toContain("Send the follow-up");
    expect(plan?.successCriteria).toEqual(["Send the follow-up", "Do laundry"]);
    expect(plan?.selectedItemIds).toHaveLength(2);
    expect(plan?.suggestedItemIds).toHaveLength(1);
    expect(plan?.suggestionSource).toBe("ai");
  });

  it("lists active items in due-date order", async () => {
    const store = new InMemoryRyanStore();
    await store.createItem({
      userId: "user-1",
      title: "Later task",
      kind: "task",
      dueAt: "2026-06-10T15:00:00.000Z"
    });
    await store.createItem({
      userId: "user-1",
      title: "Soon task",
      kind: "task",
      dueAt: "2026-06-01T15:00:00.000Z"
    });

    const items = await store.listItems({ userId: "user-1" });

    expect(items.map((item) => item.title)).toEqual(["Soon task", "Later task"]);
  });

  it("replays duplicate completion events by idempotency key", async () => {
    const store = new InMemoryRyanStore();
    const tools = createCoreToolRegistry(store);

    await tools.execute("item.create", {
      userId: "user-1",
      title: "GLP-1 shot",
      kind: "reminder"
    });

    const first = await tools.execute("item.complete", {
      userId: "user-1",
      itemRef: "GLP-1 shot",
      completedAt: "2026-05-23T15:00:00.000Z",
      idempotencyKey: "telegram:100:complete-shot"
    });
    const second = await tools.execute("item.complete", {
      userId: "user-1",
      itemRef: "GLP-1 shot",
      completedAt: "2026-05-23T15:00:00.000Z",
      idempotencyKey: "telegram:100:complete-shot"
    });

    expect(first.status).toBe("applied");
    expect(second.status).toBe("replayed");
    expect(store.itemEvents.filter((event) => event.eventType === "completed")).toHaveLength(1);
  });

  it("reopens a completed one-off item", async () => {
    const store = new InMemoryRyanStore();
    const tools = createCoreToolRegistry(store);

    await tools.execute("item.create", {
      userId: "user-1",
      title: "File expense receipt",
      kind: "task"
    });
    await tools.execute("item.complete", {
      userId: "user-1",
      itemRef: "File expense receipt",
      completedAt: "2026-05-27T15:00:00.000Z"
    });

    const reopened = await tools.execute("item.uncomplete", {
      userId: "user-1",
      itemRef: "File expense receipt"
    });

    expect(reopened.status).toBe("applied");
    const item = [...store.items.values()][0];
    expect(item?.status).toBe("open");
    expect(item?.completedAt).toBeUndefined();
    expect(store.itemEvents.filter((event) => event.eventType === "uncompleted")).toHaveLength(1);
  });

  it("records a recurrence event and updates next due", async () => {
    const store = new InMemoryRyanStore();
    const tools = createCoreToolRegistry(store);

    await tools.execute("item.create", {
      userId: "user-1",
      title: "Change sheets",
      kind: "habit"
    });
    await tools.execute("recurrence.setPolicy", {
      userId: "user-1",
      itemRef: "Change sheets",
      policy: {
        type: "completion_based",
        intervalDays: 7,
        resetFromCompletion: true
      }
    });

    const recorded = await tools.execute("recurrence.recordEvent", {
      userId: "user-1",
      recurrenceRef: "Change sheets",
      eventType: "completed",
      occurredAt: "2026-05-23T15:00:00.000Z"
    });

    expect(recorded.status).toBe("applied");
    const state = [...store.recurrenceStates.values()][0];
    expect(state?.nextDueAt).toBe("2026-05-30T15:00:00.000Z");
    expect([...store.items.values()][0]?.status).toBe("open");
  });

  it("requires an explicit override before minimum interval completions", async () => {
    const store = new InMemoryRyanStore();
    const tools = createCoreToolRegistry(store);

    await tools.execute("item.create", {
      userId: "user-1",
      title: "Take GLP-1 shot",
      kind: "habit"
    });
    await tools.execute("recurrence.setPolicy", {
      userId: "user-1",
      itemRef: "Take GLP-1 shot",
      policy: {
        type: "minimum_interval",
        minimumIntervalDays: 7,
        resetFromCompletion: true
      }
    });
    await tools.execute("recurrence.recordEvent", {
      userId: "user-1",
      recurrenceRef: "Take GLP-1 shot",
      eventType: "completed",
      occurredAt: "2026-05-20T12:00:00.000Z"
    });

    const early = await tools.execute("recurrence.recordEvent", {
      userId: "user-1",
      recurrenceRef: "Take GLP-1 shot",
      eventType: "completed",
      occurredAt: "2026-05-26T12:00:00.000Z"
    });
    expect(early.status).toBe("needs_confirmation");
    expect(store.recurrenceEvents).toHaveLength(1);

    const overridden = await tools.execute("recurrence.recordEvent", {
      userId: "user-1",
      recurrenceRef: "Take GLP-1 shot",
      eventType: "completed",
      occurredAt: "2026-05-26T12:00:00.000Z",
      overrideMinimumInterval: true
    });

    expect(overridden.status).toBe("applied");
    expect(store.recurrenceEvents).toHaveLength(2);
    const state = [...store.recurrenceStates.values()][0];
    expect(state?.lastCompletedAt).toBe("2026-05-26T12:00:00.000Z");
    expect(state?.nextDueAt).toBe("2026-06-02T12:00:00.000Z");
  });

  it("sets once-per-week completion-based recurrence from a weekly preference", async () => {
    const store = new InMemoryRyanStore();
    const tools = createCoreToolRegistry(store);

    await tools.execute("item.create", {
      userId: "user-1",
      title: "Change bed sheets",
      kind: "habit"
    });

    const result = await tools.execute("recurrence.setPolicy", {
      userId: "user-1",
      itemRef: "Change bed sheets",
      policy: {
        type: "completion_based",
        intervalDays: 7,
        resetFromCompletion: true
      }
    });

    expect(result.status).toBe("applied");
    const policy = [...store.recurrencePolicies.values()][0];
    expect(policy).toMatchObject({
      type: "completion_based",
      intervalDays: 7,
      resetFromCompletion: true
    });
  });

  it("normalizes legacy interval recurrence input to completion-based policy", async () => {
    const store = new InMemoryRyanStore();
    const tools = createCoreToolRegistry(store);

    await tools.execute("item.create", {
      userId: "user-1",
      title: "Change bed sheets",
      kind: "habit"
    });

    const result = await tools.execute("recurrence.setPolicy", {
      userId: "user-1",
      itemRef: "Change bed sheets",
      policy: {
        type: "interval",
        intervalDays: 7,
        resetFromCompletion: true
      }
    });

    expect(result.status).toBe("applied");
    expect([...store.recurrencePolicies.values()][0]?.type).toBe("completion_based");
  });

  it("rejects incomplete recurrence policies with actionable warnings", async () => {
    const store = new InMemoryRyanStore();
    const tools = createCoreToolRegistry(store);

    await tools.execute("item.create", {
      userId: "user-1",
      title: "Change bed sheets",
      kind: "habit"
    });

    const result = await tools.execute("recurrence.setPolicy", {
      userId: "user-1",
      itemRef: "Change bed sheets",
      policy: {
        type: "completion_based",
        resetFromCompletion: true
      }
    });

    expect(result.status).toBe("rejected");
    expect(result.messageForUser).toContain("intervalDays");
  });

  it("persists notification policies from typed tool calls", async () => {
    const store = new InMemoryRyanStore();
    const tools = createCoreToolRegistry(store);

    const result = await tools.execute("policy.upsertNotification", {
      userId: "user-1",
      scope: "global",
      policy: {
        quietHours: {
          weekendBefore: "09:00"
        },
        nagIntensity: "default-on"
      },
      reason: "User asked not to be messaged early on weekends."
    });

    expect(result.status).toBe("applied");
    expect(store.policies.size).toBe(1);
    const policy = [...store.policies.values()][0];
    expect(policy?.type).toBe("notification");
    expect(policy?.rules).toMatchObject({ nagIntensity: "default-on" });
  });
});
