import { describe, expect, it, vi } from "vitest";
import { InMemoryRyanStore } from "@ryanos/core";
import { buildApp } from "../src/app.js";

type VocabularyEntry = {
  id: string;
  term: string;
  normalizedTerm: string;
  languageCode: string;
  category: string;
  definition?: string;
  tags: string[];
  definitionSource: string;
  status: string;
};

type VocabularyPayload = {
  categories: string[];
  entries: VocabularyEntry[];
  encountersByEntryId: Record<string, Array<{
    id: string;
    entryId: string;
    sourceType?: string;
    context?: string;
  }>>;
};

describe("vocabulary API", () => {
  it("quick-adds vocabulary entries with encounters", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const app = buildApp();

    const added = await app.inject({
      method: "POST",
      url: "/v1/vocabulary/entries",
      payload: {
        userId: "local-owner",
        term: "sobremesa",
        languageCode: "es",
        context: "Heard on a Spanish podcast after dinner.",
        tags: ["Spanish", "Food"],
        draftWithAi: false
      }
    });
    const payload = added.json() as VocabularyPayload & { entry: VocabularyEntry };
    await app.close();

    expect(added.statusCode).toBe(200);
    expect(payload.entry).toMatchObject({
      term: "sobremesa",
      normalizedTerm: "sobremesa",
      languageCode: "es",
      category: "language",
      tags: ["spanish", "food"],
      definitionSource: "manual",
      status: "active"
    });
    expect(payload.categories).toContain("medical");
    expect(payload.encountersByEntryId[payload.entry.id]?.[0]).toMatchObject({
      sourceType: "web",
      context: "Heard on a Spanish podcast after dinner."
    });
  });

  it("filters vocabulary entries by category language tag and query", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const app = buildApp();

    await app.inject({
      method: "POST",
      url: "/v1/vocabulary/entries",
      payload: {
        userId: "local-owner",
        term: "GLP-1 agonist",
        category: "medical",
        definition: "A medicine class that activates GLP-1 receptors.",
        tags: ["metabolism"],
        draftWithAi: false
      }
    });
    await app.inject({
      method: "POST",
      url: "/v1/vocabulary/entries",
      payload: {
        userId: "local-owner",
        term: "sobremesa",
        languageCode: "es",
        tags: ["spanish"],
        draftWithAi: false
      }
    });

    const filtered = await app.inject({
      method: "GET",
      url: "/v1/vocabulary/entries?userId=local-owner&category=medical&languageCode=en&tag=metabolism&query=receptors"
    });
    const payload = filtered.json() as VocabularyPayload;
    await app.close();

    expect(filtered.statusCode).toBe(200);
    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0]).toMatchObject({
      term: "GLP-1 agonist",
      category: "medical"
    });
  });

  it("merges duplicate quick-adds without overwriting edited definitions", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const store = new InMemoryRyanStore();
    const app = buildApp({ store });

    const added = await app.inject({
      method: "POST",
      url: "/v1/vocabulary/entries",
      payload: {
        userId: "local-owner",
        term: "Serendipity",
        definition: "Draft definition",
        tags: ["reading"],
        draftWithAi: false
      }
    });
    const entry = (added.json() as { entry: VocabularyEntry }).entry;
    await app.inject({
      method: "PATCH",
      url: `/v1/vocabulary/entries/${entry.id}`,
      payload: {
        userId: "local-owner",
        definition: "Manual edited definition",
        tags: ["favorite"]
      }
    });
    const duplicate = await app.inject({
      method: "POST",
      url: "/v1/vocabulary/entries",
      payload: {
        userId: "local-owner",
        term: "serendipity",
        definition: "New draft that should not win",
        tags: ["podcast"],
        context: "Heard in an interview.",
        draftWithAi: false
      }
    });
    const payload = duplicate.json() as VocabularyPayload & { entry: VocabularyEntry; merged: boolean };
    await app.close();

    expect(duplicate.statusCode).toBe(200);
    expect(payload.merged).toBe(true);
    expect(payload.entry.id).toBe(entry.id);
    expect(payload.entry.definition).toBe("Manual edited definition");
    expect(payload.entry.tags).toEqual(["favorite", "podcast"]);
    expect(store.vocabularyEncounters).toHaveLength(2);
  });

  it("exposes mobile vocabulary list and add endpoints", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const app = buildApp();

    const added = await app.inject({
      method: "POST",
      url: "/v1/mobile/vocabulary/entries",
      payload: {
        userId: "local-owner",
        term: "iatrogenic",
        category: "medical",
        draftWithAi: false
      }
    });
    const listed = await app.inject({
      method: "GET",
      url: "/v1/mobile/vocabulary/entries?userId=local-owner&limit=100"
    });
    const payload = listed.json() as VocabularyPayload;
    await app.close();

    expect(added.statusCode).toBe(200);
    expect(listed.statusCode).toBe(200);
    expect(payload.entries).toEqual([
      expect.objectContaining({
        term: "iatrogenic",
        category: "medical"
      })
    ]);
  });
});
