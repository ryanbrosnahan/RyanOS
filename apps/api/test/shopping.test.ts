import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryRyanStore } from "@ryanos/core";
import { buildApp } from "../src/app.js";

type ShoppingItem = {
  id: string;
  name: string;
  normalizedName: string;
  category: string;
  quantity?: string;
  checked: boolean;
  checkedAt?: string;
};

type ShoppingPayload = {
  categories: string[];
  items: ShoppingItem[];
  suggestions: Array<{
    name: string;
    normalizedName: string;
    category: string;
    purchaseCount: number;
    lastPurchasedAt?: string;
  }>;
};

function itemNamed(payload: ShoppingPayload, name: string): ShoppingItem | undefined {
  return payload.items.find((item) => item.name === name);
}

describe("shopping list API", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("adds categorized items and keeps checked items visible for quick undo", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const app = buildApp();

    const added = await app.inject({
      method: "POST",
      url: "/v1/shopping/items",
      payload: {
        userId: "local-owner",
        name: "Toothpaste",
        quantity: "2"
      }
    });
    const addPayload = added.json() as ShoppingPayload & { item: ShoppingItem };

    const checked = await app.inject({
      method: "POST",
      url: `/v1/shopping/items/${addPayload.item.id}/check`,
      payload: {
        userId: "local-owner",
        checked: true
      }
    });
    const checkedPayload = checked.json() as ShoppingPayload & { item: ShoppingItem };

    const undone = await app.inject({
      method: "POST",
      url: `/v1/shopping/items/${addPayload.item.id}/check`,
      payload: {
        userId: "local-owner",
        checked: false
      }
    });
    const undoPayload = undone.json() as ShoppingPayload & { item: ShoppingItem };
    await app.close();

    expect(added.statusCode).toBe(200);
    expect(addPayload.item).toMatchObject({
      name: "Toothpaste",
      normalizedName: "toothpaste",
      category: "personal care",
      quantity: "2",
      checked: false
    });
    expect(addPayload.categories).toContain("household good");
    expect(checked.statusCode).toBe(200);
    expect(checkedPayload.item).toMatchObject({
      checked: true,
      checkedAt: expect.any(String)
    });
    expect(itemNamed(checkedPayload, "Toothpaste")?.checked).toBe(true);
    expect(checkedPayload.suggestions.some((item) => item.normalizedName === "toothpaste")).toBe(false);
    expect(undone.statusCode).toBe(200);
    expect(undoPayload.item).toMatchObject({
      checked: false
    });
    expect(undoPayload.item.checkedAt).toBeUndefined();
  });

  it("drops old checked items from the list and offers them as staples later", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const store = new InMemoryRyanStore();
    const app = buildApp({ store });

    const added = await app.inject({
      method: "POST",
      url: "/v1/shopping/items",
      payload: {
        userId: "local-owner",
        name: "Dish detergent",
        category: "household good"
      }
    });
    const item = (added.json() as { item: ShoppingItem }).item;
    await app.inject({
      method: "POST",
      url: `/v1/shopping/items/${item.id}/check`,
      payload: {
        userId: "local-owner",
        checked: true
      }
    });
    await store.updateShoppingItem(item.id, {
      checkedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    });

    const listed = await app.inject({
      method: "GET",
      url: "/v1/shopping/list?userId=local-owner"
    });
    const payload = listed.json() as ShoppingPayload;
    await app.close();

    expect(listed.statusCode).toBe(200);
    expect(payload.items.some((listedItem) => listedItem.normalizedName === "dish detergent")).toBe(false);
    expect(payload.suggestions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Dish detergent",
          normalizedName: "dish detergent",
          category: "household good",
          purchaseCount: 1,
          lastPurchasedAt: expect.any(String)
        })
      ])
    );
  });

  it("exposes the same list operations for the mobile widget", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const app = buildApp();

    const added = await app.inject({
      method: "POST",
      url: "/v1/mobile/shopping/items",
      payload: {
        userId: "local-owner",
        name: "Vitamins"
      }
    });
    const item = (added.json() as { item: ShoppingItem }).item;
    const checked = await app.inject({
      method: "POST",
      url: `/v1/mobile/shopping/items/${item.id}/check`,
      payload: {
        userId: "local-owner",
        checked: true
      }
    });
    const listed = await app.inject({
      method: "GET",
      url: "/v1/mobile/shopping/list?userId=local-owner&suggestions=0"
    });
    const payload = listed.json() as ShoppingPayload;
    await app.close();

    expect(added.statusCode).toBe(200);
    expect(item).toMatchObject({
      category: "health",
      checked: false
    });
    expect(checked.statusCode).toBe(200);
    expect(listed.statusCode).toBe(200);
    expect(payload.items).toEqual([
      expect.objectContaining({
        name: "Vitamins",
        category: "health",
        checked: true
      })
    ]);
  });
});
