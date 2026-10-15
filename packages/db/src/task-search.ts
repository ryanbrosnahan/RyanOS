import { sql } from "drizzle-orm";
import { searchTerms, type TaskSearchFilters, type TaskSearchRecord } from "@ryanos/core";

// Shared parameterized query for the owner UI and the narrowly scoped integration.
export function taskSearchQuery(userId: string, filters: TaskSearchFilters) {
  const conditions = [sql`i.user_id = ${userId}`];
  if (filters.itemId) conditions.push(sql`i.id = ${filters.itemId}::uuid`);
  if (!filters.includeDeleted) conditions.push(sql`i.deleted_at IS NULL`);
  if (filters.statuses?.length) conditions.push(sql`i.status IN (${sql.join(filters.statuses.map(status => sql`${status}::item_status`), sql`, `)})`);
  if (filters.projectId) conditions.push(sql`i.project_id = ${filters.projectId}::uuid`);
  if (filters.projectStatus) conditions.push(sql`p.status = ${filters.projectStatus}`);
  for (const term of searchTerms(filters.query)) conditions.push(sql`strpos(lower(concat_ws(' ', i.id::text, i.title, i.body, p.name, a.name)), ${term}) > 0`);
  return sql`SELECT row_to_json(i) AS item,
    CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object('id',p.id,'name',p.name,'status',p.status) END AS project,
    CASE WHEN a.id IS NULL THEN NULL ELSE json_build_object('id',a.id,'name',a.name,'status',a.status) END AS area
    FROM items i LEFT JOIN projects p ON p.id=i.project_id AND p.user_id=i.user_id
    LEFT JOIN areas a ON a.id=i.area_id AND a.user_id=i.user_id
    WHERE ${sql.join(conditions, sql` AND `)} ORDER BY i.updated_at DESC, i.id
    LIMIT ${Math.min(Math.max(filters.limit ?? 20, 1), 50)} OFFSET ${Math.max(filters.offset ?? 0, 0)}`;
}
export function taskSearchRows(rows: Record<string, unknown>[]): TaskSearchRecord[] {
  return rows.map(row => {
    const raw = row.item as Record<string, unknown>;
    const item = Object.fromEntries(Object.entries(raw).filter(([,v]) => v !== null)
      .map(([key,value]) => [key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), value])) as TaskSearchRecord["item"];
    return { item, project: row.project as TaskSearchRecord["project"], area: row.area as TaskSearchRecord["area"], href: `/tasks/${encodeURIComponent(item.id)}` };
  });
}
