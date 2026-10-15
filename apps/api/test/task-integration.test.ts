import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { createDb, TaskIntegrationStore, taskIntegrationScopes, type TaskIntegrationPrincipal } from "@ryanos/db";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { registerTaskIntegrationRoutes } from "../src/task-integration.js";
import { buildApp } from "../src/app.js";

const url = process.env.TEST_TASK_INTEGRATION_DATABASE_URL;
// Never use DATABASE_URL for these tests; require a disposable loopback database.
if (url) {
  const parsed = new URL(url);
  if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.pathname !== "/ryanos_integration_test") {
    throw new Error("Use only disposable localhost database ryanos_integration_test");
  }
}

describe.skipIf(!url)("task integration against PostgreSQL", () => {
  const database = url ? createDb(url) : undefined!;
  const pool = database?.pool;
  let store: TaskIntegrationStore;
  let p: TaskIntegrationPrincipal;
  let token: string;
  let app: ReturnType<typeof Fastify>;
  let otherUser: string;
  const evidence = [{ summary: "Synthetic external observation; not a completion", observedAt: "2026-10-14T03:10:00Z" }];
  const capture = (sourceId = "chat:message:action-1") => store.capture(p, { sourceId, title: "Review synthetic brief" });
  const headers = () => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const exists = await pool.query("SELECT to_regclass('public.task_integrations') AS name");
    if (!exists.rows[0].name) {
      const dir = fileURLToPath(new URL("../../../packages/db/drizzle/", import.meta.url));
      for (const name of (await readdir(dir)).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
        await pool.query(await readFile(`${dir}/${name}`, "utf8"));
      }
    }
  });
  beforeEach(async () => {
    const userId = randomUUID(); otherUser = randomUUID();
    await pool.query("INSERT INTO users (id,email,display_name) VALUES ($1,$2,'Synthetic owner'),($3,$4,'Other synthetic owner')",
      [userId, `${userId}@example.test`, otherUser, `${otherUser}@example.test`]);
    token = `synthetic_test_only_${userId.replaceAll("-", "")}`;
    const result = await pool.query(`INSERT INTO task_integrations (user_id,name,token_hash,scopes,expires_at)
      VALUES ($1,'synthetic fixture',$2,$3,'2050-01-01') RETURNING id`,
    [userId, createHash("sha256").update(token).digest("hex"), JSON.stringify(taskIntegrationScopes)]);
    p = { id: result.rows[0].id, userId, scopes: [...taskIntegrationScopes] };
    store = new TaskIntegrationStore(pool);
    app = Fastify();
    registerTaskIntegrationRoutes(app, { store, ownerForRequest: request =>
      request.headers["x-synthetic-owner"] === "yes" ? userId : undefined });
    await app.ready();
  });
  afterAll(async () => { await pool.end(); });
  // Fastify injection doesn't open a listener. Each instance is closed after each test.
  afterEach(async () => { await app?.close(); vi.unstubAllEnvs(); });

  it("searches existing owner tasks across statuses, description and archived project before pagination", async () => {
    const projectId=randomUUID();
    await pool.query("INSERT INTO projects (id,user_id,name,status) VALUES ($1,$2,'Family tax archive','archived')",[projectId,p.userId]);
    const taskId=randomUUID();
    await pool.query("INSERT INTO items (id,user_id,project_id,kind,title,body,status) VALUES ($1,$2,$3,'task','Review James returns','POA signature request','done')",[taskId,p.userId,projectId]);
    await pool.query("INSERT INTO items (user_id,kind,title,body) VALUES ($1,'task','Foreign James','POA signature request')",[otherUser]);
    const response=await app.inject({url:'/v1/task-integration/search?query=James%20POA&statuses=done&projectStatus=archived&limit=1',headers:headers()});
    expect(response.statusCode).toBe(200);
    expect(response.json().records).toHaveLength(1);
    expect(response.json().records[0]).toMatchObject({item:{id:taskId,status:'done',body:'POA signature request'},project:{name:'Family tax archive',status:'archived'},href:`/tasks/${taskId}`});
    await pool.query("INSERT INTO items (user_id,kind,title,body,updated_at) VALUES ($1,'task','Newer UUID reference',$2,now()+interval '1 day')",[p.userId,taskId]);
    const details=await app.inject({url:`/v1/task-integration/items/${taskId}`,headers:headers()});
    expect(details.statusCode).toBe(200);
    expect((await app.inject({url:`/v1/task-integration/items/${taskId.toUpperCase()}`,headers:headers()})).statusCode).toBe(200);
    await pool.query("UPDATE items SET deleted_at=now() WHERE id=$1",[taskId]);
    expect((await app.inject({url:'/v1/task-integration/search?query=James',headers:headers()})).json().records).toEqual([]);
    expect((await app.inject({url:'/v1/task-integration/search?query=James&includeDeleted=true',headers:headers()})).json().records).toHaveLength(1);
    expect((await app.inject({url:`/v1/task-integration/items/${randomUUID()}`,headers:headers()})).statusCode).toBe(404);
  });
  it("requires a distinct search grant and rejects user impersonation parameters", async () => {
    await pool.query("UPDATE task_integrations SET scopes=$2 WHERE id=$1",[p.id,JSON.stringify(['tasks:read','tasks:create'])]);
    expect((await app.inject({url:'/v1/task-integration/search',headers:headers()})).statusCode).toBe(403);
    await pool.query("UPDATE task_integrations SET scopes=$2 WHERE id=$1",[p.id,JSON.stringify(['tasks:search'])]);
    expect((await app.inject({url:`/v1/task-integration/search?userId=${otherUser}`,headers:headers()})).statusCode).toBe(400);
    expect((await app.inject({url:'/v1/task-integration/search?statuses=archived',headers:headers()})).statusCode).toBe(400);
    expect((await app.inject({url:'/v1/task-integration/search?limit=51',headers:headers()})).statusCode).toBe(400);
    expect((await app.inject({url:'/v1/task-integration/search?query=%25%27',headers:headers()})).statusCode).toBe(200);
  });

  it("provisions an idempotent hash-only grant and refuses conflicting reuse", async () => {
    const {provision}=await import('../../../scripts/task-integration/provision-server.mjs');
    const input={integrationId:randomUUID(),userId:p.userId,tokenHash:'1'.repeat(64),expiresAt:new Date(Date.now()+86400000).toISOString()};
    expect(await provision(pool,input)).toMatchObject({integrationId:input.integrationId,created:true});
    expect(await provision(pool,input)).toMatchObject({integrationId:input.integrationId,created:false});
    await expect(provision(pool,{...input,tokenHash:'2'.repeat(64)})).rejects.toThrow('Grant conflict');
    const row=(await pool.query('SELECT token_hash,scopes FROM task_integrations WHERE id=$1',[input.integrationId])).rows[0];
    expect(row.token_hash).toBe(input.tokenHash); expect(row.scopes).toEqual(taskIntegrationScopes);
  });

  it("creates one ordinary task under concurrent delivery and preserves all user edits on retry", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => capture()));
    expect(results.filter(result => result.created)).toHaveLength(1);
    expect(new Set(results.map(result => result.item!.id)).size).toBe(1);
    const first = results[0]!;
    expect(first.item).toMatchObject({ kind: "task", status: "open", dueAt: null });
    await pool.query("UPDATE items SET title='Ryan edited this',body='Ryan notes',priority='urgent',due_at='2027-01-01',revision=revision+1 WHERE id=$1", [first.item!.id]);
    const retry = await store.capture(p, { sourceId: first.sourceId, title: "Overwrite attempt", body: "Different body" });
    expect(retry.created).toBe(false);
    expect(retry.item).toMatchObject({ title: "Ryan edited this", body: "Ryan notes", priority: "urgent", revision: 2 });
    expect(retry.item!.dueAt!.toISOString()).toMatch(/^2027-01-01/);
  });
  it("keeps soft deletion suppressed across adapter restarts and retries", async () => {
    const task = await capture();
    await pool.query("UPDATE items SET deleted_at=now(),revision=revision+1 WHERE id=$1", [task.item!.id]);
    store = new TaskIntegrationStore(pool);
    expect(await capture()).toMatchObject({ created: false, suppressed: true, suppressionReason: "deleted", item: null });
    expect(await store.read(p, task.sourceId)).toMatchObject({ suppressed: true });
  });
  it("keeps a hard-deleted item's source tombstone", async () => {
    const task = await capture();
    await pool.query("DELETE FROM item_events WHERE item_id=$1", [task.item!.id]);
    await pool.query("DELETE FROM items WHERE id=$1", [task.item!.id]);
    expect(await capture()).toMatchObject({ created: false, suppressed: true, item: null });
  });
  it("suppresses cancelled tasks and never reopens completed tasks", async () => {
    const cancelled = await capture("cancelled");
    await pool.query("UPDATE items SET status='cancelled',revision=revision+1 WHERE id=$1", [cancelled.item!.id]);
    expect(await capture("cancelled")).toMatchObject({ created: false, suppressed: true, suppressionReason: "cancelled" });
    const done = await capture("done");
    await pool.query("UPDATE items SET status='done',completed_at=now(),revision=revision+1 WHERE id=$1", [done.item!.id]);
    expect(await capture("done")).toMatchObject({ created: false, item: { status: "done" } });
  });
  it("allows owner dismissal before completion and prevents recapture", async () => {
    const task = await capture();
    await store.requestCompletion(p, task.sourceId, "request-1", evidence);
    await expect(store.dismiss(otherUser, task.captureId)).rejects.toMatchObject({ statusCode: 404 });
    await store.dismiss(p.userId, task.captureId);
    expect(await capture()).toMatchObject({ created: false, suppressed: true, suppressionReason: "dismissed", item: { status: "open" } });
    expect(await store.pending(p.userId)).toEqual([]);
    await expect(store.requestCompletion(p, task.sourceId, "new", [])).rejects.toMatchObject({ statusCode: 409 });
  });
  it("keeps stable source identity after credential rotation", async () => {
    const task = await capture();
    const rotatedToken = `${token}_rotated`;
    await pool.query("UPDATE task_integrations SET token_hash=$2 WHERE id=$1", [p.id, createHash("sha256").update(rotatedToken).digest("hex")]);
    expect(await store.authenticate(token)).toBeUndefined();
    const rotated = await store.authenticate(rotatedToken);
    expect(await store.capture(rotated!, { sourceId: task.sourceId, title: "Retry" })).toMatchObject({ created: false, item: { id: task.item!.id } });
  });
  it("isolates source identifiers and item reads by integration", async () => {
    const task = await capture();
    const foreign = { ...p, id: randomUUID(), userId: otherUser };
    await expect(store.read(foreign, task.sourceId)).rejects.toMatchObject({ statusCode: 404 });
    await expect(store.decide(otherUser, randomUUID(), true, 1)).rejects.toMatchObject({ statusCode: 404 });
  });
  it("records evidence without completing or verifying the item", async () => {
    const task = await capture();
    const request = await store.requestCompletion(p, task.sourceId, "request-1", evidence);
    const replay = await store.requestCompletion(p, task.sourceId, "request-1", []);
    expect(replay.id).toBe(request.id);
    expect(replay.evidence).toEqual(evidence);
    expect(await store.read(p, task.sourceId)).toMatchObject({ item: { status: "open", completedAt: null } });
    expect(await store.pending(p.userId)).toHaveLength(1);
    expect(await store.pending(otherUser)).toEqual([]);
  });
  it("requires an owner decision and records its audit and completion separately", async () => {
    const task = await capture();
    const request = await store.requestCompletion(p, task.sourceId, "request-1", evidence);
    await expect(store.decide(otherUser, request.id, true, 1)).rejects.toMatchObject({ statusCode: 404 });
    const done = await store.decide(p.userId, request.id, true, 1);
    expect(done.item).toMatchObject({ status: "done", revision: 2 });
    expect(done.completionRequests[0]).toMatchObject({ status: "approved", evidence });
    await expect(store.decide(p.userId, request.id, true, 1)).rejects.toMatchObject({ statusCode: 409 });
    const events = await pool.query("SELECT event_type,payload FROM item_events WHERE item_id=$1 ORDER BY created_at", [task.item!.id]);
    expect(events.rows.map(row => row.event_type)).toEqual(["created", "completed"]);
    const audit = await pool.query("SELECT actor_type FROM audit_logs WHERE action='task.completion.approve' AND user_id=$1", [p.userId]);
    expect(audit.rows).toEqual([{ actor_type: "user" }]);
  });
  it("rejects stale approval after user edits and permits a fresh request", async () => {
    const task = await capture();
    const request = await store.requestCompletion(p, task.sourceId, "request-1", evidence);
    await pool.query("UPDATE items SET title='Changed',revision=revision+1 WHERE id=$1", [task.item!.id]);
    await expect(store.decide(p.userId, request.id, true, 1)).rejects.toMatchObject({ statusCode: 409 });
    await expect(store.decide(p.userId, request.id, true, 2)).rejects.toMatchObject({ statusCode: 409 });
    await store.decide(p.userId, request.id, false, 2);
    const next = await store.requestCompletion(p, task.sourceId, "request-2", evidence);
    expect((await store.decide(p.userId, next.id, true, 2)).item!.status).toBe("done");
  });
  it("rejects completion after deletion, cancellation or conversion to a habit", async () => {
    for (const mode of ["deleted_at=now()", "status='cancelled'", "kind='habit'"]) {
      const task = await capture(`change-${mode.replaceAll(/[^a-z]/g, "")}`);
      const request = await store.requestCompletion(p, task.sourceId, "request-1", []);
      await pool.query(`UPDATE items SET ${mode},revision=revision+1 WHERE id=$1`, [task.item!.id]);
      await expect(store.decide(p.userId, request.id, true, 1)).rejects.toMatchObject({ statusCode: 409 });
    }
  });
  it("refuses the one-off completion path after a recurrence policy is attached", async () => {
    const task = await capture();
    const request = await store.requestCompletion(p, task.sourceId, "request-1", []);
    // A policy can be attached without changing the item's revision.
    await pool.query("INSERT INTO recurrence_policies (user_id,item_id,type,interval_days) VALUES ($1,$2,'completion_based',7)", [p.userId, task.item!.id]);
    await expect(store.decide(p.userId, request.id, true, 1)).rejects.toMatchObject({ statusCode: 409 });
    expect((await store.read(p, task.sourceId)).item!.status).toBe("open");
  });
  it("serializes owner approval against an in-flight recurrence insert", async () => {
    const task = await capture();
    const request = await store.requestCompletion(p, task.sourceId, "request-1", []);
    const writer = await pool.connect();
    await writer.query("BEGIN");
    const writerPid = (await writer.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await writer.query("INSERT INTO recurrence_policies (user_id,item_id,type,interval_days) VALUES ($1,$2,'completion_based',7)", [p.userId, task.item!.id]);
    let outcome: { value?: unknown; error?: unknown } | undefined;
    const decision = store.decide(p.userId, request.id, true, 1).then(
      value => { outcome = { value }; }, error => { outcome = { error }; });
    let blocked = false;
    try {
      for (let attempt = 0; attempt < 50 && !outcome; attempt++) {
        const locks = await pool.query("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked", [writerPid]);
        if (locks.rows[0].blocked) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    } finally {
      await writer.query("COMMIT"); writer.release(); await decision;
    }
    expect(blocked).toBe(true);
    expect(outcome?.error).toMatchObject({ statusCode: 409 });
    expect((await store.read(p, task.sourceId)).item!.status).toBe("open");
  });
  it("isolates actual HTTP reads, completion decisions and dismissals across two valid owners", async () => {
    const foreignToken = `${token}_other`;
    const row = await pool.query(`INSERT INTO task_integrations (user_id,name,token_hash,scopes,expires_at)
      VALUES ($1,'other synthetic fixture',$2,$3,'2050-01-01') RETURNING id`,
    [otherUser, createHash("sha256").update(foreignToken).digest("hex"), JSON.stringify(taskIntegrationScopes)]);
    const foreignHeaders = { authorization: `Bearer ${foreignToken}` };
    const own = await app.inject({ method: "POST", url: "/v1/task-integration/tasks", headers: headers(), payload: { sourceId: "same-source", title: "Owner A task" } });
    const foreign = await app.inject({ method: "POST", url: "/v1/task-integration/tasks", headers: foreignHeaders, payload: { sourceId: "same-source", title: "Owner B task" } });
    expect(own.statusCode).toBe(200); expect(foreign.statusCode).toBe(200);
    expect(own.json().item.id).not.toBe(foreign.json().item.id);
    expect((await app.inject({ method: "GET", url: "/v1/task-integration/tasks?sourceId=same-source", headers: headers() })).json().item.title).toBe("Owner A task");
    expect((await app.inject({ method: "GET", url: "/v1/task-integration/tasks?sourceId=same-source", headers: foreignHeaders })).json().item.title).toBe("Owner B task");
    await store.capture({ id: row.rows[0].id, userId: otherUser, scopes: [...taskIntegrationScopes] }, { sourceId: "foreign-only", title: "Private to B" });
    expect((await app.inject({ method: "GET", url: "/v1/task-integration/tasks?sourceId=foreign-only", headers: headers() })).statusCode).toBe(404);
    const requested = await app.inject({ method: "POST", url: "/v1/task-integration/completion-requests", headers: foreignHeaders, payload: { sourceId: "same-source", requestKey: "request-1", evidence } });
    expect(requested.statusCode).toBe(200);
    const ownerHeaders = { "x-synthetic-owner": "yes" };
    expect((await app.inject({ method: "GET", url: "/v1/task-integration-requests", headers: ownerHeaders })).json().requests).toEqual([]);
    expect((await app.inject({ method: "POST", url: `/v1/task-integration-requests/${requested.json().request.id}/decision`, headers: ownerHeaders, payload: { approve: true, expectedRevision: 1 } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/v1/task-integration-captures/${foreign.json().captureId}/dismiss`, headers: ownerHeaders, payload: { dismiss: true } })).statusCode).toBe(404);
  });
  it("enforces revocation and expiry on all bearer routes", async () => {
    const task = await capture();
    for (const condition of ["expires_at=now()-interval '1 second'", "expires_at='2050-01-01',revoked_at=now()"]) {
      await pool.query(`UPDATE task_integrations SET ${condition} WHERE id=$1`, [p.id]);
      const requests = [
        { method: "GET" as const, url: "/v1/task-integration/search" },
        { method: "GET" as const, url: `/v1/task-integration/items/${task.item!.id}` },
        { method: "GET" as const, url: `/v1/task-integration/tasks?sourceId=${task.sourceId}` },
        { method: "POST" as const, url: "/v1/task-integration/tasks", payload: { sourceId: "new", title: "Blocked" } },
        { method: "POST" as const, url: "/v1/task-integration/completion-requests", payload: { sourceId: task.sourceId, requestKey: "blocked" } }
      ];
      for (const request of requests) expect((await app.inject({ ...request, headers: headers() })).statusCode).toBe(401);
    }
  });
  it("requires scoped bearer auth even with an owner session", async () => {
    const result = await app.inject({ method: "POST", url: "/v1/task-integration/tasks", headers: { "x-synthetic-owner": "yes" }, payload: { sourceId: "new", title: "No token" } });
    expect(result.statusCode).toBe(401);
    await pool.query("UPDATE task_integrations SET scopes='[]' WHERE id=$1", [p.id]);
    expect((await app.inject({ method: "POST", url: "/v1/task-integration/tasks", headers: headers(), payload: { sourceId: "new", title: "No scope" } })).statusCode).toBe(403);
  });
  it("enforces each individual token scope on its actual route", async () => {
    const task = await capture();
    for (const granted of taskIntegrationScopes) {
      await pool.query("UPDATE task_integrations SET scopes=$2 WHERE id=$1", [p.id, JSON.stringify([granted])]);
      const cases = [
        { scope: "tasks:search", method: "GET" as const, url: "/v1/task-integration/search?query=synthetic&statuses=open,done" },
        { scope: "tasks:search", method: "GET" as const, url: `/v1/task-integration/items/${task.item!.id}` },
        { scope: "tasks:read", method: "GET" as const, url: `/v1/task-integration/tasks?sourceId=${task.sourceId}` },
        { scope: "tasks:create", method: "POST" as const, url: "/v1/task-integration/tasks", payload: { sourceId: task.sourceId, title: "Do not overwrite" } },
        { scope: "completion:request", method: "POST" as const, url: "/v1/task-integration/completion-requests", payload: { sourceId: task.sourceId, requestKey: "scope-review" } }
      ];
      for (const { scope, ...request } of cases) {
        expect((await app.inject({ ...request, headers: headers() })).statusCode).toBe(scope === granted ? 200 : 403);
      }
    }
  });
  it("denies expired and revoked credentials", async () => {
    await pool.query("UPDATE task_integrations SET expires_at=now()-interval '1 second' WHERE id=$1", [p.id]);
    expect(await store.authenticate(token)).toBeUndefined();
    await pool.query("UPDATE task_integrations SET expires_at='2050-01-01',revoked_at=now() WHERE id=$1", [p.id]);
    expect(await store.authenticate(token)).toBeUndefined();
  });
  it("does not let a create-only token read user edits", async () => {
    const task = await capture();
    await pool.query("UPDATE task_integrations SET scopes='[\"tasks:create\"]' WHERE id=$1", [p.id]);
    const result = await app.inject({ method: "POST", url: "/v1/task-integration/tasks", headers: headers(), payload: { sourceId: task.sourceId, title: "Retry" } });
    expect(result.statusCode).toBe(200);
    expect(result.json().item).toBeUndefined();
    expect((await app.inject({ method: "GET", url: `/v1/task-integration/tasks?sourceId=${task.sourceId}`, headers: headers() })).statusCode).toBe(403);
  });
  it("blocks direct completion with a token and rejects unrecognized caller fields", async () => {
    const task = await capture();
    const request = await store.requestCompletion(p, task.sourceId, "request-1", evidence);
    expect((await app.inject({ method: "POST", url: `/v1/task-integration-requests/${request.id}/decision`, headers: headers(), payload: { approve: true, expectedRevision: 1 } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/v1/task-integration/tasks", headers: headers(), payload: { sourceId: "new", title: "Task", userId: otherUser, status: "done" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/v1/task-integration/completion-requests", headers: headers(), payload: { sourceId: task.sourceId, requestKey: "new", evidence: [{ ...evidence[0], sourceUrl: "file:///secret" }] } })).statusCode).toBe(400);
  });
  it("rolls back the source ledger, item and event when its audit write fails", async () => {
    await pool.query(`CREATE FUNCTION task_integration_test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$`);
    await pool.query(`CREATE TRIGGER task_integration_test_audit BEFORE INSERT ON audit_logs FOR EACH ROW
      WHEN (NEW.user_id = '${p.userId}'::uuid) EXECUTE FUNCTION task_integration_test_fail_audit()`);
    try {
      await expect(store.capture(p, { sourceId: "rollback", title: "Must not persist" })).rejects.toBeDefined();
      expect((await pool.query("SELECT id FROM task_captures WHERE integration_id=$1 AND source_id='rollback'", [p.id])).rows).toEqual([]);
      expect((await pool.query("SELECT id FROM items WHERE user_id=$1", [p.userId])).rows).toEqual([]);
      expect((await pool.query("SELECT id FROM item_events WHERE user_id=$1", [p.userId])).rows).toEqual([]);
    } finally {
      await pool.query("DROP TRIGGER task_integration_test_audit ON audit_logs");
      await pool.query("DROP FUNCTION task_integration_test_fail_audit()");
    }
  });
  it("wires token routes through required auth while keeping owner approval behind Better Auth", async () => {
    vi.stubEnv("DATABASE_URL", url!);
    vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-test-only-auth-secret-000000000000000000");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3100");
    const actual = buildApp({ authMode: "required" });
    try {
      const create = await actual.inject({ method: "POST", url: "/v1/task-integration/tasks", headers: headers(), payload: { sourceId: "wired", title: "Synthetic task" } });
      expect(create.statusCode).toBe(200);
      expect((await actual.inject({ method: "GET", url: "/v1/task-integration-requests", headers: headers() })).statusCode).toBe(401);
      expect((await actual.inject({ method: "POST", url: `/v1/items/${create.json().item.id}/complete`, headers: headers(), payload: { completed: true } })).statusCode).toBe(401);
    } finally { await actual.close(); }
  });
  it("accepts a real synthetic Better Auth owner decision only from a trusted origin", async () => {
    vi.stubEnv("DATABASE_URL", url!);
    vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-test-only-auth-secret-000000000000000000");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3100");
    vi.stubEnv("RYANOS_CORS_ORIGINS", "http://localhost:3100");
    vi.stubEnv("RYANOS_INVITE_CODES", "");
    const actual = buildApp({ authMode: "required" });
    try {
      const signup = await actual.inject({ method: "POST", url: "/auth/sign-up/email",
        headers: { origin: "http://localhost:3100" },
        payload: { name: "Synthetic owner", email: `${randomUUID()}@example.test`, password: "synthetic-password-only-0000" } });
      expect(signup.statusCode).toBe(200);
      const cookies = signup.cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; ");
      const sessionHeaders = { cookie: cookies, origin: "http://localhost:3100" };
      const me = await actual.inject({ method: "GET", url: "/v1/me", headers: sessionHeaders });
      expect(me.statusCode).toBe(200);
      const ownerId = me.json().user.id;
      await pool.query("UPDATE task_integrations SET user_id=$2 WHERE id=$1", [p.id, ownerId]);
      const created = await actual.inject({ method: "POST", url: "/v1/task-integration/tasks", headers: headers(), payload: { sourceId: "owner-session", title: "Review synthetic task" } });
      expect(created.statusCode).toBe(200);
      const requested = await actual.inject({ method: "POST", url: "/v1/task-integration/completion-requests", headers: headers(), payload: { sourceId: "owner-session", requestKey: "owner-review-1", evidence } });
      expect(requested.statusCode).toBe(200);
      const id = requested.json().request.id;
      const decision = { method: "POST" as const, url: `/v1/task-integration-requests/${id}/decision`, payload: { approve: true, expectedRevision: 1 } };
      expect((await actual.inject({ ...decision, headers: { cookie: cookies } })).statusCode).toBe(403);
      expect((await actual.inject({ ...decision, headers: { cookie: cookies, origin: "https://untrusted.example" } })).statusCode).toBe(403);
      expect((await actual.inject({ method: "GET", url: "/v1/task-integration-requests", headers: sessionHeaders })).json().requests).toHaveLength(1);
      const approved = await actual.inject({ ...decision, headers: sessionHeaders });
      expect(approved.statusCode).toBe(200);
      expect(approved.json()).toMatchObject({ item: { status: "done" }, completionRequests: [{ status: "approved", evidence }] });
    } finally { await actual.close(); }
  });

});
