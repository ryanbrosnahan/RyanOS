import { describe, expect, it } from "vitest";
import { InMemoryRyanStore } from "./in-memory-store.js";
import { createCoreToolRegistry } from "./tools.js";

describe("core tools", () => {
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
  });
});

