import type pg from "pg";

export type SharedRecord = {
  id: string; user_id: string; shortcode: string; url: string;
  status: string; attempts: number; generation: number; result: Record<string, unknown>;
  manual: Record<string, unknown>; error: string | null; review: string;
  created_at: string; updated_at: string;
};
export interface SharedRepository {
  save(user: string, shortcode: string, url: string): Promise<SharedRecord>;
  list(user: string, offset: number): Promise<SharedRecord[]>;
  get(user: string, id: string): Promise<SharedRecord | undefined>;
  retry(user: string, id: string): Promise<SharedRecord | undefined>;
  update(user: string, id: string, manual: Record<string, unknown> | undefined, review: string | undefined): Promise<SharedRecord | undefined>;
  token(user: string, hash: string | null): Promise<void>;
  tokenUser(hash: string): Promise<string | undefined>;
  process(id: string, generation: number, run: (row: SharedRecord) => Promise<{ status: string; result: Record<string, unknown>; error: string | null; retry: boolean }>): Promise<boolean>;
}

export class PostgresSharedRepository implements SharedRepository {
  constructor(private pool: pg.Pool) {}
  private async enqueue(client: pg.PoolClient, row: SharedRecord) {
    await client.query("select graphile_worker.add_job('ryanos.shared.capture', $1::json, max_attempts := 3, job_key := $2, queue_name := 'shared-capture')", [JSON.stringify({ id: row.id, generation: row.generation }), `shared:${row.id}:${row.generation}`]);
  }
  private async transaction<T>(run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); const result = await run(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  async save(user: string, shortcode: string, url: string) {
    return this.transaction(async client => {
      // Serialize per-user intake, including the quota and duplicate check.
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [user]);
      const existing = await client.query<SharedRecord>("select * from shared_content where user_id=$1 and shortcode=$2", [user, shortcode]);
      if (existing.rows[0]) return existing.rows[0];
      const count = await client.query("select count(*)::int as n from shared_content where user_id=$1 and created_at > now()-interval '1 day'", [user]);
      if (count.rows[0].n >= 30) throw new Error("Shared daily capture limit reached");
      const inserted = await client.query<SharedRecord>("insert into shared_content(user_id,shortcode,url) values($1,$2,$3) returning *", [user, shortcode, url]);
      const row = inserted.rows[0]!;
      await this.enqueue(client, row);
      return row;
    });
  }
  private async reconcile(user: string) {
    await this.pool.query(`update shared_content s set
      status=case when result='{}'::jsonb then 'failed' else 'partial' end,
      error='worker_delivery_exhausted', updated_at=now()
      where user_id=$1 and status in ('queued','retrying') and exists (
        select 1 from graphile_worker.jobs j
        where j.key='shared:' || s.id::text || ':' || s.generation::text
          and j.attempts>=j.max_attempts and j.locked_at is null
      )`, [user]);
  }
  async list(user: string, offset: number) {
    await this.reconcile(user);
    return (await this.pool.query<SharedRecord>("select *, result - 'frames' as result from shared_content where user_id=$1 order by created_at desc,id desc limit 50 offset $2", [user, offset])).rows;
  }
  async get(user: string, id: string) { await this.reconcile(user); return (await this.pool.query<SharedRecord>("select * from shared_content where user_id=$1 and id=$2", [user, id])).rows[0]; }
  async retry(user: string, id: string) {
    await this.reconcile(user);
    return this.transaction(async client => {
      const result = await client.query<SharedRecord>("update shared_content set status='queued', error=null, attempts=0, generation=generation+1, updated_at=now() where user_id=$1 and id=$2 and generation < 5 and status not in ('queued','processing','retrying') and updated_at < now()-interval '1 minute' returning *", [user, id]);
      const row = result.rows[0];
      if (row) await this.enqueue(client, row);
      return row;
    });
  }
  async update(user: string, id: string, manual: Record<string, unknown> | undefined, review: string | undefined) {
    return (await this.pool.query<SharedRecord>("update shared_content set manual=coalesce($3::jsonb,manual), review=coalesce($4,review), updated_at=now() where user_id=$1 and id=$2 returning *", [user,id,manual ? JSON.stringify(manual) : null,review ?? null])).rows[0];
  }
  async token(user: string, hash: string | null) {
    if (!hash) { await this.pool.query("delete from shared_intake_tokens where user_id=$1", [user]); return; }
    await this.pool.query("insert into shared_intake_tokens(user_id,token_hash,expires_at) values($1,$2,now()+interval '90 days') on conflict(user_id) do update set token_hash=excluded.token_hash, expires_at=excluded.expires_at", [user,hash]);
  }
  async tokenUser(hash: string) { return (await this.pool.query("select user_id from shared_intake_tokens where token_hash=$1 and expires_at>now()", [hash])).rows[0]?.user_id as string | undefined; }
  async process(id: string, generation: number, run: Parameters<SharedRepository["process"]>[2]) {
    // A transaction-scoped lock prevents duplicate signed deliveries and retries from overlapping.
    // Crash/timeout rolls back the claim; Graphile Worker redelivers the durable job.
    return this.transaction(async client => {
      const selected = await client.query<SharedRecord>("select * from shared_content where id=$1 and generation=$2 for update", [id,generation]);
      const row = selected.rows[0];
      if (!row || !['queued','retrying'].includes(row.status)) return false;
      const outcome = await run(row);
      const retry = outcome.retry && row.attempts + 1 < 3;
      await client.query("update shared_content set attempts=attempts+1,status=$2,result=$3::jsonb,error=$4,updated_at=now() where id=$1", [id,retry ? 'retrying' : outcome.status,JSON.stringify(outcome.result),outcome.error]);
      return retry;
    });
  }
}
