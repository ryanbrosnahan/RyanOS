import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryRyanStore } from "@ryanos/core";
import { buildApp } from "../src/app.js";

async function fixture() {
  vi.stubEnv("DATABASE_URL", "");
  const store = new InMemoryRyanStore();
  const app = buildApp({ store, authMode: "dev-local" });
  const created = await app.inject({
    method: "POST",
    url: "/v1/tools/item.create/invoke",
    payload: { input: { title: "Gym", kind: "habit" } },
  });
  const items = await store.listItems({ userId: "local-owner" });
  const item = items[0]!;
  if (!item) throw new Error(created.body);
  const policy = await store.upsertRecurrencePolicy({
    userId: "local-owner",
    itemId: item.id,
    type: "target_frequency",
    targetCount: 3,
    targetWindowDays: 7,
    resetFromCompletion: true,
    status: "active",
    metadata: {},
  });
  await store.addRecurrenceEvent({
    userId: "local-owner",
    itemId: item.id,
    recurrencePolicyId: policy.id,
    eventType: "completed",
    occurredAt: "2026-01-01T12:00:00Z",
    payload: {},
  });
  return { app, item, store };
}
afterEach(() => vi.unstubAllEnvs());
describe("adherence API", () => {
  it("serves the authorized report and rejects invalid zones and other owners", async () => {
    const { app, item } = await fixture();
    try {
      const result = await app.inject(
        `/v1/items/${item.id}/adherence?timezone=UTC`,
      );
      expect(result.statusCode).toBe(200);
      expect(result.json()).toMatchObject({
        title: "Gym",
        report: { total: 1, start: "2026-01-01", timezone: "UTC" },
      });
      expect(result.headers["cache-control"]).toBe("private, no-store");
      expect(
        (await app.inject(`/v1/items/${item.id}/adherence?timezone=invalid`))
          .statusCode,
      ).toBe(400);
      expect(
        (
          await app.inject(
            `/v1/items/${item.id}/adherence?userId=another-owner`,
          )
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await app.inject(
            `/v1/items/${item.id}/adherence?userId=another-owner&format=pdf`,
          )
        ).statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
  });
  it("downloads a real PDF and returns 404 for non-recurring tasks", async () => {
    const { app, item, store } = await fixture();
    try {
      const result = await app.inject(
        `/v1/items/${item.id}/adherence?format=pdf`,
      );
      expect(result.statusCode).toBe(200);
      expect(result.headers["content-type"]).toBe("application/pdf");
      expect(result.headers["content-disposition"]).toContain("attachment;");
      expect(result.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
      expect(result.rawPayload.length).toBeGreaterThan(5000);
      await store.upsertRecurrencePolicy({
        userId: "local-owner",
        itemId: item.id,
        type: "opportunistic",
        resetFromCompletion: true,
        status: "archived",
        metadata: {},
      });
      expect(
        (await app.inject(`/v1/items/${item.id}/adherence`)).statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
  });
});
