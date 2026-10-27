import { describe, expect, it } from "vitest";
import { InMemoryRyanStore } from "./in-memory-store.js";
import { createCoreToolRegistry } from "./tools.js";

async function fixture() {
  const store = new InMemoryRyanStore();
  const areas: Record<string, string> = {};
  for (const name of ["Home", "Work", "Business", "Health", "Family", "Finance", "Personal"]) {
    areas[name] = (await store.upsertArea({ userId: "ryan", name })).id;
  }
  return { store, areas };
}

describe("automatic item areas", () => {
  it.each([
    ["Pay 2025 IRS income tax", "Finance"],
    ["Call Window Genie for gutter cleaning", "Home"],
    ["Give Toby his medication", "Home"],
    ["Take GLP-1 shot", "Health"],
    ["Go to the gym", "Health"],
    ["Review Dad's medical paperwork", "Family"],
    ["Classify RyanOS OAuth clients", "Work"],
    ["Do a press release", "Business"],
    ["Keep AAdvantage miles from expiring", "Personal"],
    ["Review bank message", "Finance"],
    ["Plan wedding reception", "Personal"]
  ])("categorizes %s as %s", async (title, name) => {
    const { store, areas } = await fixture();
    const item = await store.createItem({ userId: "ryan", title, kind: "task" });
    expect(item.areaId).toBe(areas[name]);
    expect(item.metadata.areaClassification).toMatchObject({ version: 1 });
  });

  it("preserves explicit choices and existing metadata", async () => {
    const { store, areas } = await fixture();
    const item = await store.createItem({ userId: "ryan", title: "Pay IRS tax", kind: "task", areaId: areas.Business!, metadata: { source: "manual" } });
    expect(item.areaId).toBe(areas.Business);
    expect(item.metadata).toEqual({ source: "manual" });
  });

  it("inherits the selected project and recognizes project names without assigning a project", async () => {
    const { store, areas } = await fixture();
    const project = await store.upsertProject({ userId: "ryan", name: "Method", areaId: areas.Business! });
    const explicit = await store.createItem({ userId: "ryan", title: "Review tax documents", kind: "task", projectId: project.id });
    const inferred = await store.createItem({ userId: "ryan", title: "Schedule Method governance discussion", kind: "task" });
    expect(explicit.areaId).toBe(areas.Business);
    expect(inferred.areaId).toBe(areas.Business);
    expect(inferred.projectId).toBeUndefined();
  });

  it("uses previously corrected tasks for a custom area, including completed history", async () => {
    const { store, areas } = await fixture();
    const custom = await store.upsertArea({ userId: "ryan", name: "Community" });
    const previous = await store.createItem({ userId: "ryan", title: "Prepare neighborhood association newsletter", kind: "task", areaId: areas.Personal! });
    await store.updateItem(previous.id, { areaId: custom.id, status: "done" });
    const item = await store.createItem({ userId: "ryan", title: "Review neighborhood association newsletter", kind: "task" });
    expect(item.areaId).toBe(custom.id);
    expect(item.metadata.areaClassification).toMatchObject({ method: "history" });
  });

  it("does not infer from another user's history or paused areas", async () => {
    const { store, areas } = await fixture();
    const paused = await store.upsertArea({ userId: "ryan", name: "Archive", status: "paused" });
    await store.createItem({ userId: "ryan", title: "Call Alex", kind: "task", areaId: paused.id });
    const other = await store.upsertArea({ userId: "other", name: "Client" });
    await store.createItem({ userId: "other", title: "Call Alex", kind: "task", areaId: other.id });
    const item = await store.createItem({ userId: "ryan", title: "Call Alex", kind: "task" });
    expect(item.areaId).toBe(areas.Personal);
  });

  it("uses Personal for ambiguity and retains proposal provenance", async () => {
    const { store, areas } = await fixture();
    const item = await store.createItem({ userId: "ryan", title: "Call Alex", kind: "task", metadata: { source: "gmail_proposal", emailProposalId: "proposal" } });
    expect(item.areaId).toBe(areas.Personal);
    expect(item.metadata).toMatchObject({ source: "gmail_proposal", emailProposalId: "proposal", areaClassification: { method: "fallback" } });
  });

  it("does not invent taxonomy for users with no areas", async () => {
    const store = new InMemoryRyanStore();
    const item = await store.createItem({ userId: "new-user", title: "Go to the gym", kind: "task" });
    expect(item.areaId).toBeUndefined();
    expect(store.areas.size).toBe(0);
  });

  it("uses Pets when present and avoids ambiguous project-name matches", async () => {
    const { store, areas } = await fixture();
    const pets = await store.upsertArea({ userId: "ryan", name: "Pets" });
    await store.upsertProject({ userId: "ryan", name: "CPL", areaId: areas.Work! });
    await store.upsertProject({ userId: "ryan", name: "CPL", areaId: areas.Personal! });
    expect((await store.createItem({ userId: "ryan", title: "Give Toby medication", kind: "task" })).areaId).toBe(pets.id);
    expect((await store.createItem({ userId: "ryan", title: "Review CPL lab results", kind: "task" })).areaId).toBe(areas.Health);
  });

  it("keeps chat/tool-created items on the same classification path", async () => {
    const { store, areas } = await fixture();
    const tools = createCoreToolRegistry(store);
    const result = await tools.execute("item.create", { userId: "ryan", title: "Review bank message" });
    expect(result.status).toBe("applied");
    expect([...store.items.values()][0]?.areaId).toBe(areas.Finance);
  });
});
