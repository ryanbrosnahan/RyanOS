import type { ItemCreateData, RyanStore } from "./store.js";

const ignoredWords = new Set("a an and are as at be by can check create do email for from get have i in is it me my new of on or please reply request respond review schedule send task that the their this to update want wants we with about follow up documents paperwork".split(" "));

function normalize(value: string): string {
  return value.toLowerCase().replace(/https?:\/\/\S+/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

function tokens(value: string): Set<string> {
  return new Set(normalize(value).split(" ").filter((word) => word.length >= 3 && !ignoredWords.has(word)));
}

const areaRules = [
  { names: ["family"], terms: /\b(dad|mom|mother|father|grandpa|grandma|grandparent|parents|assisted living|memory care|james brosnahan)\b/g, weight: 15 },
  { names: ["pets", "pet care", "home"], terms: /\b(toby|dog|cat|pet|pets|groomer|veterinarian|vet)\b/g, weight: 13 },
  { names: ["home", "household"], terms: /\b(house|household|clean|cleaning|laundry|sheets|dishwasher|sink|gutter|yard|garden|gardening|azaleas|landscap\w*|exterminator|hoa|water filter|home repair)\b/g, weight: 10 },
  { names: ["finance", "finances", "money"], terms: /\b(tax|taxes|irs|bank|banking|mortgage|refinanc\w*|invoice|credit card|cash back|monarch|fidelity|income|expenses|latap|oktap|loan|insurance premium)\b/g, weight: 10 },
  { names: ["health", "wellness", "fitness"], terms: /\b(health|doctor|dentist|medical|medicine|medication|prescription|pharmacy|gym|exercise|workout|shot|testosterone|glp 1|cjc|mot c|mychart|lab|xray|5k|race)\b/g, weight: 10 },
  { names: ["work", "business"], terms: /\b(ryanos|court nox|courtnox|filemytro|github|oauth|software|server|code|coding|jury|rfp|fedramp|twilio|posthog|knockwell|certification|court visit)\b/g, weight: 10 },
  { names: ["business", "work"], terms: /\b(business|llc|company|client|vendor|press release|billboard|property manager|lease|airbnb|sales|marketing|governance|dba|commercial)\b/g, weight: 9 },
  { names: ["travel", "personal"], terms: /\b(travel|flight|airline|aadvantage|miles|hotel|passport|vacation)\b/g, weight: 10 },
  { names: ["personal"], terms: /\b(wedding|florist|tuxedo|groomsmen|rehearsal|barber|haircut|car|mechanic|powerball|mega millions)\b/g, weight: 10 }
];

/** Best-fit fallback shared by every item creation path; never calls an external service. */
export async function assignItemArea(store: RyanStore, data: ItemCreateData): Promise<ItemCreateData> {
  if (data.areaId !== undefined) return data;
  const allAreas = await store.listAreas(data.userId);
  if (data.projectId) {
    const project = await store.getProject(data.projectId);
    const parent = project?.userId === data.userId ? allAreas.find((area) => area.id === project.areaId) : undefined;
    if (parent) return classified(parent.id, "project", "Inherited the selected project's area.");
  }
  const areas = allAreas.filter((area) => area.status === "active" && !area.deletedAt);
  if (areas.length === 0) return data;
  const [projects, history] = await Promise.all([
    store.listProjects({ userId: data.userId, limit: 200 }),
    store.listItems({ userId: data.userId, statuses: ["open", "active", "waiting", "done"], limit: 200 })
  ]);
  const scores = new Map(areas.map((area) => [area.id, { score: 0, reason: "", method: "best_fit" }]));
  const title = normalize(data.title);
  // Do not let email footers, links, or scanner rationale outweigh the actual task.
  const body = normalize((data.body ?? "").split(/\n\s*(?:why:|email:|primary source:|other sources:)/i)[0]!.slice(0, 1200));
  const titleTokens = tokens(data.title);
  const add = (id: string, score: number, reason: string, method = "best_fit") => {
    const current = scores.get(id);
    if (current && score > current.score) scores.set(id, { score, reason, method });
  };
  const areaNamed = (names: string[]) => names.map((name) => areas.find((area) => normalize(area.name) === name)).find(Boolean);

  for (const rule of areaRules) {
    const area = areaNamed(rule.names);
    if (!area) continue;
    const titleMatches = [...title.matchAll(rule.terms)].length;
    const bodyMatches = [...body.matchAll(rule.terms)].length;
    if (titleMatches) add(area.id, rule.weight + Math.min(titleMatches - 1, 3), "Matched the task's subject.");
    else if (bodyMatches) add(area.id, rule.weight * 0.6, "Matched the task description.");
  }
  if (data.kind === "opportunity_action") {
    const work = areaNamed(["work", "business"]);
    if (work) add(work.id, 8, "Matched an opportunity action.");
  }
  for (const area of areas) {
    const name = normalize(area.name);
    if (name && ` ${title} `.includes(` ${name} `)) add(area.id, 12, "The task names this area.");
  }
  for (const project of projects.filter((project) => project.status === "active" && !project.deletedAt && project.areaId)) {
    const name = normalize(project.name);
    const conflicting = projects.some((other) => normalize(other.name) === name && other.areaId && other.areaId !== project.areaId && other.status === "active" && !other.deletedAt);
    if (name.length >= 3 && !conflicting && ` ${title} `.includes(` ${name} `)) {
      add(project.areaId!, 22, "The task names an existing project.", "project_match");
    }
  }
  for (const previous of history) {
    if (!previous.areaId || !scores.has(previous.areaId) || previous.deletedAt || previous.userId !== data.userId) continue;
    if (normalize(previous.title) === title) {
      add(previous.areaId, 30, "Matched a previously categorized task.", "history");
      continue;
    }
    const previousTokens = tokens(previous.title);
    const shared = [...titleTokens].filter((word) => previousTokens.has(word));
    const similarity = shared.length / Math.sqrt(Math.max(1, titleTokens.size * previousTokens.size));
    if (shared.length >= 2 && similarity >= 0.5) add(previous.areaId, 16 * similarity, "Similar to a previously categorized task.", "history");
  }
  const ranked = [...scores].sort((a, b) => b[1].score - a[1].score);
  const best = ranked[0];
  if (best && best[1].score > 0 && (!ranked[1] || best[1].score > ranked[1][1].score)) {
    return classified(best[0], best[1].method, best[1].reason);
  }
  const fallback = areaNamed(["personal", "general", "other", "inbox"]);
  return fallback ? classified(fallback.id, "fallback", "Personal or general area used because the task has no clear domain.") : data;

  function classified(areaId: string, method: string, reason: string): ItemCreateData {
    return { ...data, areaId, metadata: { ...data.metadata, areaClassification: { version: 1, method, reason } } };
  }
}
