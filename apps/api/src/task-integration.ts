import type { FastifyInstance, FastifyRequest } from "fastify";
import { TaskIntegrationError, type TaskIntegrationScope, type TaskIntegrationStore } from "@ryanos/db";
import { z } from "zod";

const sourceId = z.string().min(1).max(240).regex(/^[A-Za-z0-9:._/-]+$/);
const sourceQuery = z.object({ sourceId }).strict();
const captureBody = z.object({
  sourceId, title: z.string().trim().min(1).max(500), body: z.string().max(10000).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  dueAt: z.iso.datetime({ offset: true }).optional()
}).strict();
const requestBody = z.object({
  sourceId, requestKey: sourceId,
  evidence: z.array(z.object({
    summary: z.string().trim().min(1).max(2000),
    sourceUrl: z.url().refine(value => ["https:", "http:"].includes(new URL(value).protocol)).optional(),
    observedAt: z.iso.datetime({ offset: true })
  }).strict()).max(20).default([])
}).strict();
const decisionBody = z.object({ approve: z.boolean(), expectedRevision: z.number().int().positive() }).strict();
const idParams = z.object({ id: z.uuid() }).strict();

const taskSearchInput = z.object({
  query: z.string().trim().max(500).default(""),
  statuses: z.string().optional().transform(value => value?.split(",")).pipe(z.array(z.enum(["open", "active", "waiting", "done", "cancelled"])).min(1).max(5).optional()),
  includeDeleted: z.enum(["true", "false"]).default("false").transform(value => value === "true"),
  projectId: z.uuid().optional(), projectStatus: z.enum(["active", "archived"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20), offset: z.coerce.number().int().min(0).max(100000).default(0)
}).strict();

// ownerForRequest must return only a trusted, current Better Auth identity, never body input.
export function registerTaskIntegrationRoutes(app: FastifyInstance, options: {
  store?: TaskIntegrationStore | undefined;
  searchOwner?: ((userId: string, filters: import("@ryanos/core").TaskSearchFilters) => Promise<import("@ryanos/core").TaskSearchRecord[]>) | undefined;
  ownerForRequest: (request: FastifyRequest) => string | undefined;
}) {
  const store = () => {
    if (!options.store) throw new TaskIntegrationError(503, "Task integration requires PostgreSQL");
    return options.store;
  };
  const owner = (request: FastifyRequest) => {
    const userId = options.ownerForRequest(request);
    if (!userId) throw new TaskIntegrationError(403, "Owner session and trusted origin required");
    return userId;
  };
  const principal = async (request: FastifyRequest, scope: TaskIntegrationScope) => {
    const match = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{32,256})$/);
    if (!match) throw new TaskIntegrationError(401, "Integration authentication required");
    const p = await store().authenticate(match[1]!);
    if (!p) throw new TaskIntegrationError(401, "Invalid or expired integration credential");
    if (!p.scopes.includes(scope)) throw new TaskIntegrationError(403, "Integration scope required");
    return p;
  };
  const route = (run: (request: FastifyRequest) => Promise<unknown>) => async (request: FastifyRequest, reply: import("fastify").FastifyReply) => {
    try { return await run(request); }
    catch (error) {
      if (error instanceof TaskIntegrationError) return reply.code(error.statusCode).send({ error: error.message });
      if (error instanceof z.ZodError) return reply.code(400).send({ error: "Invalid task integration input" });
      // No SQL, credential, evidence or user payload in the error response.
      return reply.code(500).send({ error: "Task integration operation failed" });
    }
  };

  app.get("/v1/task-integration/search", route(async (request) => {
    const p = await principal(request, "tasks:search");
    return { records: await store().search(p, taskSearchInput.parse(request.query)) };
  }));
  app.get("/v1/task-integration/items/:id", route(async (request) => {
    const p = await principal(request, "tasks:search");
    const id = idParams.parse(request.params).id.toLowerCase();
    z.object({}).strict().parse(request.query);
    const records = await store().search(p, { query: "", itemId: id, includeDeleted: true, limit: 1 });
    const record = records.find(record => record.item.id === id);
    if (!record) throw new TaskIntegrationError(404, "Task not found");
    return { record };
  }));
  app.get("/v1/task-search", route(async request => {
    const userId = owner(request);
    if (!options.searchOwner) throw new TaskIntegrationError(503, "Task search unavailable");
    return { records: await options.searchOwner(userId, taskSearchInput.parse(request.query)) };
  }));
  app.get("/v1/task-search/:id", route(async request => {
    const userId = owner(request);
    if (!options.searchOwner) throw new TaskIntegrationError(503, "Task search unavailable");
    const id = idParams.parse(request.params).id.toLowerCase();
    const records = await options.searchOwner(userId, { query: "", itemId: id, includeDeleted: true, limit: 1 });
    const record = records.find(record => record.item.id === id);
    if (!record) throw new TaskIntegrationError(404, "Task not found");
    return { record };
  }));

  app.post("/v1/task-integration/tasks", route(async request => {
    const p = await principal(request, "tasks:create");
    const result = await store().capture(p, captureBody.parse(request.body));
    return p.scopes.includes("tasks:read") ? result : {
      created: result.created, captureId: result.captureId, sourceId: result.sourceId,
      suppressed: result.suppressed, itemId: result.item?.id ?? null
    };
  }));
  app.get("/v1/task-integration/tasks", route(async request => {
    const p = await principal(request, "tasks:read");
    return store().read(p, sourceQuery.parse(request.query).sourceId);
  }));
  app.post("/v1/task-integration/completion-requests", route(async request => {
    const p = await principal(request, "completion:request");
    const body = requestBody.parse(request.body);
    return { request: await store().requestCompletion(p, body.sourceId, body.requestKey, body.evidence) };
  }));
  app.get("/v1/task-integration-requests", route(async request => ({ requests: await store().pending(owner(request)) })));
  app.post("/v1/task-integration-requests/:id/decision", route(async request => {
    const userId = owner(request);
    const body = decisionBody.parse(request.body);
    return store().decide(userId, idParams.parse(request.params).id, body.approve, body.expectedRevision);
  }));
  app.post("/v1/task-integration-captures/:id/dismiss", route(async request => {
    const userId = owner(request);
    z.object({ dismiss: z.literal(true) }).strict().parse(request.body);
    return store().dismiss(userId, idParams.parse(request.params).id);
  }));
}
