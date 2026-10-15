import type { Item, ItemStatus } from "./types.js";

export type TaskSearchFilters = {
  itemId?: string | undefined; query: string; statuses?: ItemStatus[] | undefined; includeDeleted?: boolean | undefined;
  projectId?: string | undefined; projectStatus?: string | undefined; limit?: number | undefined; offset?: number | undefined;
};
export type TaskSearchRecord = {
  item: Item; project: { id: string; name: string; status: string } | null;
  area: { id: string; name: string; status: string } | null; href: string;
};
export const searchTerms = (query: string) => query.trim().toLowerCase().split(/\s+/u).filter(Boolean).slice(0, 20);
export function searchRecordMatches(record: TaskSearchRecord, filters: TaskSearchFilters) {
  const { item, project, area } = record;
  if ((filters.itemId && item.id !== filters.itemId) || (!filters.includeDeleted && item.deletedAt) ||
      (filters.statuses?.length && !filters.statuses.includes(item.status)) ||
      (filters.projectId && item.projectId !== filters.projectId) ||
      (filters.projectStatus && project?.status !== filters.projectStatus)) return false;
  const haystack = [item.id, item.title, item.body, project?.name, area?.name].join(" ").toLowerCase();
  return searchTerms(filters.query).every(term => haystack.includes(term));
}
