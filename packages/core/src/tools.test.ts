import { describe, expect, it } from "vitest";
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
    expect(itemCreate?.inputSchema).toMatchObject({
      properties: {
        kind: {
          enum: ["task", "reminder", "decision", "note", "waiting", "habit", "other"]
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
