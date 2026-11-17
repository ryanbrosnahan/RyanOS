import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { createDb, PostgresSharedRepository } from '@ryanos/db';

// Explicit disposable test URL only. Never falls back to DATABASE_URL.
const connection = process.env.RYANOS_SHARED_TEST_DATABASE_URL;
describe.skipIf(!connection)('Shared PostgreSQL and Graphile Worker integration',()=>{
  const db = connection ? createDb(connection) : undefined;
  const repo = db ? new PostgresSharedRepository(db.pool) : undefined;
  const alice=randomUUID(),bob=randomUUID();
  beforeAll(async()=>{
    if (!connection || !/localhost:55439|127\.0\.0\.1:55439/.test(connection)) throw new Error('Requires isolated local test database on port 55439');
    await db!.pool.query('drop table if exists shared_intake_tokens, shared_content');
    await db!.pool.query('create table if not exists users(id uuid primary key)');
    await db!.pool.query(await readFile(new URL('../../../packages/db/drizzle/0016_shared_content.sql',import.meta.url),'utf8'));
    await db!.pool.query('insert into users(id) values($1),($2)',[alice,bob]);
    const requireWorker=createRequire(new URL('../../worker/package.json',import.meta.url));
    const {makeWorkerUtils}=requireWorker('graphile-worker');
    const utils=await makeWorkerUtils({connectionString:connection});try{await utils.migrate();}finally{await utils.release();}
    await db!.pool.query('delete from graphile_worker._private_jobs');
  });
  afterAll(async()=>{await db?.pool.end();});
  it('atomically deduplicates concurrent submissions per user and enqueues once',async()=>{
    const rows=await Promise.all(Array.from({length:8},()=>repo!.save(alice,'DfyuklPvzI5','https://www.instagram.com/p/DfyuklPvzI5/')));
    expect(new Set(rows.map(r=>r.id)).size).toBe(1);
    const jobs=await db!.pool.query('select count(*)::int as n from graphile_worker.jobs');expect(jobs.rows[0].n).toBe(1);
    const other=await repo!.save(bob,'DfyuklPvzI5','https://www.instagram.com/p/DfyuklPvzI5/');expect(other.id).not.toBe(rows[0]!.id);
    expect(await repo!.get(bob,rows[0]!.id)).toBeUndefined();expect(await repo!.update(bob,rows[0]!.id,{notes:'bad'},'saved')).toBeUndefined();
  });
  it('persists retry state and stops after three attempts',async()=>{
    const row=await repo!.save(alice,'retry123','https://www.instagram.com/p/retry123/');
    const run=async()=>({status:'failed',result:{caption:'retained'},error:'instagram_throttled',retry:true});
    expect(await repo!.process(row.id,0,run)).toBe(true);expect(await repo!.process(row.id,0,run)).toBe(true);expect(await repo!.process(row.id,0,run)).toBe(false);
    const saved=await repo!.get(alice,row.id);expect(saved?.attempts).toBe(3);expect(saved?.status).toBe('failed');
    expect(await repo!.retry(alice,row.id)).toBeUndefined();
    await db!.pool.query("update shared_content set updated_at=now()-interval '2 minutes' where id=$1",[row.id]);
    expect((await repo!.retry(alice,row.id))?.generation).toBe(1);expect(await repo!.process(row.id,0,run)).toBe(false);
  });
  it('rolls back interrupted capture and serializes duplicate worker deliveries',async()=>{
    const row=await repo!.save(alice,'crash123','https://www.instagram.com/p/crash123/');await expect(repo!.process(row.id,0,async()=>{throw new Error('crash');})).rejects.toThrow('crash');expect((await repo!.get(alice,row.id))?.attempts).toBe(0);
    let runs=0;await Promise.all([1,2].map(()=>repo!.process(row.id,0,async()=>{runs++;return {status:'partial',result:{frames:[{id:'frame-0',image:'evidence'}]},error:null,retry:false};})));expect(runs).toBe(1);
    expect((await repo!.get(alice,row.id))?.result.frames).toBeDefined();expect((await repo!.list(alice,0)).find(r=>r.id===row.id)?.result.frames).toBeUndefined();
  });
  it('surfaces exhausted worker transport attempts instead of leaving queued forever',async()=>{
    const row=await repo!.save(alice,'network123','https://www.instagram.com/p/network123/');
    await db!.pool.query("update graphile_worker._private_jobs set attempts=max_attempts,last_error='transport failed' where key=$1",[`shared:${row.id}:0`]);
    const item=await repo!.get(alice,row.id);expect(item?.status).toBe('failed');expect(item?.error).toBe('worker_delivery_exhausted');
  });
  it('expires and revokes hashed owner-scoped tokens',async()=>{
    const hash=createHash('sha256').update('test-token').digest('hex');await repo!.token(alice,hash);expect(await repo!.tokenUser(hash)).toBe(alice);
    await db!.pool.query("update shared_intake_tokens set expires_at=now()-interval '1 second' where user_id=$1",[alice]);expect(await repo!.tokenUser(hash)).toBeUndefined();await repo!.token(alice,null);expect(await repo!.tokenUser(hash)).toBeUndefined();
  });
});
