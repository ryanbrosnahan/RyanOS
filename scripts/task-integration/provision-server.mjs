// Internal stdin-only receiver, executed in the existing Lenovo API container after approval.
import { createDb } from '../../packages/db/dist/index.js';
import { readInput } from './runner.mjs';
export const scopes=['tasks:create','tasks:read','tasks:search','completion:request'];
export function validateGrant(input,now=Date.now()) {
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  if(!input || Object.keys(input).sort().join(',')!=='expiresAt,integrationId,tokenHash,userId' ||
     !uuid.test(input.integrationId)||!uuid.test(input.userId)||! /^[0-9a-f]{64}$/.test(input.tokenHash)||
     !Number.isFinite(Date.parse(input.expiresAt)) || Date.parse(input.expiresAt)<=now || Date.parse(input.expiresAt)>now+30*86400000+300000) throw new Error('Invalid grant');
  return input;
}
export async function provision(pool,input) {
  const v=validateGrant(input);
  const result=await pool.query(`INSERT INTO task_integrations (id,user_id,name,token_hash,scopes,expires_at)
    VALUES ($1,$2,'Personal Mac assistant',$3,$4,$5) ON CONFLICT (id) DO NOTHING RETURNING id`,[v.integrationId,v.userId,v.tokenHash,JSON.stringify(scopes),v.expiresAt]);
  const existing=await pool.query(`SELECT id,user_id,token_hash,expires_at,revoked_at,scopes FROM task_integrations WHERE id=$1`,[v.integrationId]);
  const row=existing.rows[0];
  if(!row||row.user_id!==v.userId||row.token_hash!==v.tokenHash||row.revoked_at||new Date(row.expires_at).toISOString()!==new Date(v.expiresAt).toISOString()||JSON.stringify(row.scopes)!==JSON.stringify(scopes)) throw new Error('Grant conflict');
  return {integrationId:row.id,created:result.rowCount===1,scopes,expiresAt:v.expiresAt};
}
if(process.argv[1] === new URL(import.meta.url).pathname) {
  let database;
  try { const input=validateGrant(await readInput(process.stdin)); database=createDb(); const result=await provision(database.pool,input); process.stdout.write(JSON.stringify(result)+'\n'); }
  catch { process.stderr.write('Provisioning unconfirmed; no credentials or database details printed.\n'); process.exitCode=1; }
  finally { await database?.pool.end(); }
}
