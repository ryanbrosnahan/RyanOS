import { drizzle } from "drizzle-orm/node-postgres";
import { taskSearchQuery, taskSearchRows } from "./task-search.js";
import { createHash } from "node:crypto";
import type pg from "pg";

export const taskIntegrationScopes = ["tasks:create", "tasks:read", "tasks:search", "completion:request"] as const;
export type TaskIntegrationScope = typeof taskIntegrationScopes[number];
export type TaskIntegrationPrincipal = { id: string; userId: string; scopes: string[] };
export class TaskIntegrationError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}
export type CapturedTask = {
  sourceId: string; title: string; body?: string | undefined;
  priority?: "low" | "normal" | "high" | "urgent" | undefined;
  dueAt?: string | undefined;
};
export type VerificationEvidence = {
  summary: string; sourceUrl?: string | undefined; observedAt: string;
};

// This adapter owns its durable source ledger, not the user's editable item fields.
export class TaskIntegrationStore {
  constructor(private pool: pg.Pool) {}

  async search(p: TaskIntegrationPrincipal, filters: import("@ryanos/core").TaskSearchFilters) {
    const result = await drizzle(this.pool).execute(taskSearchQuery(p.userId, filters));
    return taskSearchRows(result.rows);
  }

  async authenticate(token: string): Promise<TaskIntegrationPrincipal | undefined> {
    const digest = createHash("sha256").update(token).digest("hex");
    const result = await this.pool.query(
      `SELECT id, user_id AS "userId", scopes FROM task_integrations
       WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`, [digest]);
    return result.rows[0] as TaskIntegrationPrincipal | undefined;
  }

  private async transaction<T>(run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await run(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  private async audit(c: pg.PoolClient, userId: string, actor: string, action: string, target: string) {
    await c.query(`INSERT INTO audit_logs (user_id, actor_type, actor_id, action, target_type, target_id, status)
      VALUES ($1, $2, $3, $4, 'task_capture', $5, 'success')`,
    [userId, actor === userId ? "user" : "integration", actor, action, target]);
  }

  private async state(c: pg.PoolClient, integrationId: string, sourceId: string) {
    const result = await c.query(`SELECT c.id, c.source_id AS "sourceId", c.item_id AS "itemId",
      c.suppressed_at AS "suppressedAt", c.suppression_reason AS "suppressionReason",
      i.kind, i.title, i.body, i.status, i.priority, i.due_at AS "dueAt", i.revision,
      i.completed_at AS "completedAt", i.deleted_at AS "deletedAt", i.updated_at AS "updatedAt"
      FROM task_captures c LEFT JOIN items i ON i.id = c.item_id
      WHERE c.integration_id = $1 AND c.source_id = $2 FOR UPDATE OF c`, [integrationId, sourceId]);
    const row = result.rows[0];
    if (!row) throw new TaskIntegrationError(404, "Source task not found");
    // Tombstones survive deletion, cancellation, restarts, retries and token rotation.
    if (!row.suppressedAt && (!row.itemId || row.deletedAt || row.status === "cancelled")) {
      const reason = row.status === "cancelled" ? "cancelled" : "deleted";
      const suppression = await c.query(`UPDATE task_captures SET suppressed_at = now(), suppression_reason = $2
        WHERE id = $1 RETURNING suppressed_at`, [row.id, reason]);
      row.suppressedAt = suppression.rows[0].suppressed_at;
      row.suppressionReason = reason;
    }
    const requests = await c.query(`SELECT id, status, evidence, requested_at AS "requestedAt",
      decided_at AS "decidedAt" FROM task_completion_requests WHERE capture_id = $1 ORDER BY requested_at, id`, [row.id]);
    return {
      captureId: row.id as string,
      sourceId: row.sourceId as string,
      suppressed: Boolean(row.suppressedAt),
      suppressionReason: row.suppressionReason as string | null,
      item: row.itemId && !row.deletedAt ? {
        id: row.itemId as string, kind: row.kind as string, title: row.title as string, body: row.body as string | null,
        status: row.status as string, priority: row.priority as string, dueAt: row.dueAt as Date | null,
        revision: row.revision as number, completedAt: row.completedAt as Date | null, updatedAt: row.updatedAt as Date
      } : null,
      // Caller-supplied observations are not RyanOS verification or completion state.
      completionRequests: requests.rows
    };
  }

  async capture(p: TaskIntegrationPrincipal, input: CapturedTask) {
    return this.transaction(async c => {
      // Unique insertion serializes concurrent captures before any item is created.
      const claimed = await c.query(`INSERT INTO task_captures (integration_id, user_id, source_id)
        VALUES ($1, $2, $3) ON CONFLICT (integration_id, source_id) DO NOTHING RETURNING id`,
      [p.id, p.userId, input.sourceId]);
      if (claimed.rows[0]) {
        const item = await c.query(`INSERT INTO items (user_id, kind, title, body, priority, due_at)
          VALUES ($1, 'task', $2, $3, $4, $5) RETURNING id`,
        [p.userId, input.title, input.body ?? null, input.priority ?? "normal", input.dueAt ?? null]);
        const itemId = item.rows[0].id as string;
        await c.query("UPDATE task_captures SET item_id = $2 WHERE id = $1", [claimed.rows[0].id, itemId]);
        await c.query(`INSERT INTO item_events (user_id, item_id, event_type, occurred_at, payload)
          VALUES ($1, $2, 'created', now(), $3)`, [p.userId, itemId, JSON.stringify({ source: "task_integration", sourceId: input.sourceId })]);
        await this.audit(c, p.userId, p.id, "task.capture", claimed.rows[0].id);
      }
      return { created: Boolean(claimed.rows[0]), ...await this.state(c, p.id, input.sourceId) };
    });
  }

  async read(p: TaskIntegrationPrincipal, sourceId: string) {
    return this.transaction(c => this.state(c, p.id, sourceId));
  }

  async requestCompletion(p: TaskIntegrationPrincipal, sourceId: string, requestKey: string, evidence: VerificationEvidence[]) {
    return this.transaction(async c => {
      const state = await this.state(c, p.id, sourceId);
      const capture = await c.query("SELECT id FROM task_captures WHERE integration_id = $1 AND source_id = $2", [p.id, sourceId]);
      // An idempotent retry returns the original request, including a prior rejection.
      const existing = await c.query("SELECT * FROM task_completion_requests WHERE capture_id = $1 AND request_key = $2", [capture.rows[0].id, requestKey]);
      if (existing.rows[0]) return existing.rows[0];
      if (state.suppressed || !state.item || state.item.status === "done") throw new TaskIntegrationError(409, "Task is suppressed or already done");
      const result = await c.query(`INSERT INTO task_completion_requests (capture_id, request_key, item_revision, evidence)
        VALUES ($1, $2, $3, $4) RETURNING *`, [capture.rows[0].id, requestKey, state.item.revision, JSON.stringify(evidence)]);
      await this.audit(c, p.userId, p.id, "task.completion.request", capture.rows[0].id);
      return result.rows[0];
    });
  }

  async pending(userId: string) {
    const result = await this.pool.query(`SELECT r.id, c.id AS "captureId", r.item_revision AS "itemRevision", r.evidence,
      r.requested_at AS "requestedAt", c.source_id AS "sourceId", c.integration_id AS "integrationId",
      c.suppressed_at AS "suppressedAt", i.id AS "itemId", i.kind, i.title, i.body, i.priority, i.due_at AS "dueAt", i.status, i.revision, i.deleted_at AS "deletedAt"
      FROM task_completion_requests r JOIN task_captures c ON c.id = r.capture_id
      LEFT JOIN items i ON i.id = c.item_id WHERE c.user_id = $1 AND r.status = 'pending' ORDER BY r.requested_at, r.id LIMIT 100`, [userId]);
    return result.rows;
  }

  async dismiss(userId: string, captureId: string) {
    return this.transaction(async c => {
      const result = await c.query(`UPDATE task_captures SET suppressed_at = COALESCE(suppressed_at, now()),
        suppression_reason = COALESCE(suppression_reason, 'dismissed') WHERE id = $1 AND user_id = $2 RETURNING id`, [captureId, userId]);
      if (!result.rows[0]) throw new TaskIntegrationError(404, "Source task not found");
      await c.query("UPDATE task_completion_requests SET status = 'rejected', decided_at = now() WHERE capture_id = $1 AND status = 'pending'", [captureId]);
      await this.audit(c, userId, userId, "task.capture.dismiss", captureId);
      return { suppressed: true };
    });
  }

  async decide(userId: string, requestId: string, approve: boolean, expectedRevision: number) {
    return this.transaction(async c => {
      // Same capture -> request -> item lock order as capture/read/requestCompletion.
      const lookup = await c.query(`SELECT c.id, c.integration_id, c.source_id, c.item_id FROM task_captures c
        JOIN task_completion_requests r ON r.capture_id = c.id WHERE r.id = $1 AND c.user_id = $2 FOR UPDATE OF c`, [requestId, userId]);
      const capture = lookup.rows[0];
      if (!capture) throw new TaskIntegrationError(404, "Completion request not found");
      const result = await c.query("SELECT * FROM task_completion_requests WHERE id = $1 FOR UPDATE", [requestId]);
      const request = result.rows[0];
      if (request.status !== "pending") throw new TaskIntegrationError(409, "Request already decided");
      if (approve && capture.item_id) {
        // FOR UPDATE conflicts with a new recurrence policy's FK KEY SHARE lock.
        // After any writer commits, the fresh statements below must see its policy.
        // UPDATE alone takes NO KEY UPDATE and would permit the insert to race.
        await c.query("SELECT id FROM items WHERE id = $1 FOR UPDATE", [capture.item_id]);
      }
      const state = await this.state(c, capture.integration_id, capture.source_id);
      if (approve) {
        if (state.suppressed || !state.item || state.item.status === "done" || state.item.kind !== "task" ||
            state.item.revision !== expectedRevision || request.item_revision !== expectedRevision) {
          throw new TaskIntegrationError(409, "Task changed; review current RyanOS state and submit a fresh request");
        }
        // Optimistic update also protects against ordinary UI writes after our read.
        const updated = await c.query(`UPDATE items SET status = 'done', completed_at = now(), starred_at = NULL, updated_at = now(), revision = revision + 1
          WHERE id = $1 AND user_id = $2 AND revision = $3 AND deleted_at IS NULL AND status IN ('open','active','waiting') AND kind = 'task'
          AND NOT EXISTS (SELECT 1 FROM recurrence_policies WHERE item_id = items.id AND deleted_at IS NULL) RETURNING id`,
        [state.item.id, userId, expectedRevision]);
        if (!updated.rows[0]) throw new TaskIntegrationError(409, "Task changed; review again");
        await c.query(`INSERT INTO item_events (user_id, item_id, event_type, occurred_at, payload)
          VALUES ($1, $2, 'completed', now(), $3)`, [userId, state.item.id, JSON.stringify({ source: "owner_approved_integration_request", requestId })]);
      }
      await c.query("UPDATE task_completion_requests SET status = $2, decided_at = now() WHERE id = $1", [requestId, approve ? "approved" : "rejected"]);
      await this.audit(c, userId, userId, approve ? "task.completion.approve" : "task.completion.reject", capture.id);
      return this.state(c, capture.integration_id, capture.source_id);
    });
  }
}
