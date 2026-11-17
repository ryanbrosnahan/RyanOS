import { sharedAdaptersFromEnv } from './shared-adapters.js';
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { SharedRepository } from '@ryanos/db';
import { loadSecretVaultFromEnv } from '@ryanos/db';
import { captureShared } from './shared-capture.js';
import { normalizeInstagramUrl, CaptureError } from './shared-fetch.js';
import { internalSharedCapturePath, verifyInternalSharedCaptureRequest } from './internal-shared-auth.js';
export const sharedIntakePath = '/v1/shared/intake';
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const idSchema = z.object({id:z.string().uuid()});
const manualSchema = z.object({caption:z.string().max(12_000).default(''),transcript:z.string().max(30_000).default(''),notes:z.string().max(12_000).default('')}).strict();
export function registerSharedRoutes(app: FastifyInstance, options: {
  repository: SharedRepository | undefined;
  userId: (request: FastifyRequest) => string | undefined;
  origins: Set<string>;
  capture?: typeof captureShared;
}) {
  const repo = options.repository;
  app.register(async shared => {
    shared.addHook('preHandler',async (request,reply) => {
      reply.header('Cache-Control','no-store');
      if (!repo) return reply.code(503).send({error:'Shared requires PostgreSQL and the queue migration.'});
      if (request.method !== 'GET' && request.headers.origin && !options.origins.has(request.headers.origin)) return reply.code(403).send({error:'Untrusted origin'});
    });
    shared.setErrorHandler((error,_request,reply) => {
      if (error instanceof z.ZodError || error instanceof CaptureError) return reply.code(400).send({error:error instanceof CaptureError ? error.code : 'Invalid Shared request'});
      if (error && typeof error === 'object' && 'statusCode' in error && error.statusCode === 413) return reply.code(413).send({error:'Shared request exceeds size limit'});
      if (error instanceof Error && error.message === 'Shared daily capture limit reached') return reply.code(429).send({error:error.message});
      // Database/network errors may include URLs or sensitive payloads; do not log/return them.
      return reply.code(503).send({error:'Shared operation unavailable. Check database and worker configuration.'});
    });
    shared.post(sharedIntakePath,{bodyLimit:4096},async (request,reply) => {
      const bearer = request.headers.authorization?.match(/^Bearer ([-_A-Za-z0-9]{43})$/)?.[1];
      const user = bearer ? await repo!.tokenUser(hash(bearer)) : undefined;
      if (!user) return reply.code(401).send({error:'Valid Shared intake token required'});
      const body = z.object({url:z.string().max(2048)}).strict().parse(request.body);
      const canonical = normalizeInstagramUrl(body.url);
      const item = await repo!.save(user,canonical.shortcode,canonical.url);
      return reply.code(202).send({id:item.id,url:item.url,status:item.status});
    });
    // Everything below uses a logged-in owner session, never the intake bearer token.
    shared.addHook('preHandler',async (request,reply) => {
      const path = request.url.split('?')[0];
      if (path !== sharedIntakePath && path !== internalSharedCapturePath && !options.userId(request)) return reply.code(401).send({error:'Session required'});
    });
    shared.post('/v1/shared/tokens',async (request,reply) => {
      const token = randomBytes(32).toString('base64url');
      await repo!.token(options.userId(request)!,hash(token));
      return reply.send({token,expiresInDays:90});
    });
    shared.delete('/v1/shared/tokens',async request => { await repo!.token(options.userId(request)!,null); return {revoked:true}; });
    shared.get('/v1/shared',async request => {
      const query = z.object({offset:z.coerce.number().int().min(0).max(100_000).default(0)}).parse(request.query);
      return {items:await repo!.list(options.userId(request)!,query.offset)};
    });
    shared.post('/v1/shared',{bodyLimit:4096},async (request,reply) => {
      const body = z.object({url:z.string().max(2048)}).strict().parse(request.body);
      const canonical = normalizeInstagramUrl(body.url);
      return reply.code(202).send(await repo!.save(options.userId(request)!,canonical.shortcode,canonical.url));
    });
    shared.get('/v1/shared/:id',async (request,reply) => {
      const {id} = idSchema.parse(request.params); const item = await repo!.get(options.userId(request)!,id);
      return item ?? reply.code(404).send({error:'Not found'});
    });
    shared.post('/v1/shared/:id/retry',async (request,reply) => {
      const {id} = idSchema.parse(request.params); const item = await repo!.retry(options.userId(request)!,id);
      return item ?? reply.code(409).send({error:'Not found, already queued, or retried within the last minute'});
    });
    shared.patch('/v1/shared/:id',{bodyLimit:64_000},async (request,reply) => {
      const {id} = idSchema.parse(request.params);
      const body = z.object({manual:manualSchema.optional(),review:z.enum(['unreviewed','saved','dismissed']).optional()}).strict().parse(request.body);
      const item = await repo!.update(options.userId(request)!,id,body.manual,body.review);
      return item ?? reply.code(404).send({error:'Not found'});
    });
    shared.post(internalSharedCapturePath,{bodyLimit:4096},async (request,reply) => {
      const {vault} = await loadSecretVaultFromEnv();
      const timestamp = request.headers['x-ryanos-internal-timestamp']; const signature = request.headers['x-ryanos-internal-signature'];
      if (!vault || !verifyInternalSharedCaptureRequest({masterKey:vault.key,body:JSON.stringify(request.body ?? {}),timestamp:typeof timestamp === 'string' ? timestamp : undefined,signature:typeof signature === 'string' ? signature : undefined})) return reply.code(401).send({error:'Invalid internal authentication'});
      const body = z.object({id:z.string().uuid(),generation:z.number().int().min(0)}).strict().parse(request.body);
      const retry = await repo!.process(body.id,body.generation,async row => {
        const outcome = await (options.capture ?? captureShared)(row.url, sharedAdaptersFromEnv());
        const previous = row.result;
        if ((previous.caption || (Array.isArray(previous.frames) && previous.frames.length)) && (!Array.isArray(outcome.result.frames) || !outcome.result.frames.length)) {
          outcome.result = { ...previous, warnings: [...(Array.isArray(outcome.result.warnings) ? outcome.result.warnings : []), 'Showing retained evidence from an earlier capture; latest attempt did not replace it.'] };
          outcome.status = 'partial';
        }
        return outcome;
      });
      return reply.code(retry ? 503 : 200).send({retry});
    });
  });
}
