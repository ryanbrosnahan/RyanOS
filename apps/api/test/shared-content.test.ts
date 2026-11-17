import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { randomUUID, createHash } from 'node:crypto';
import { normalizeInstagramUrl, allowedDownloadUrl, publicIPv4, CaptureError } from '../src/shared-fetch.js';
import { captureShared, parseInstagramHtml, validateAnalysis, type SharedEvidence } from '../src/shared-capture.js';
import { registerSharedRoutes } from '../src/shared-routes.js';
import { signInternalSharedCaptureRequest, verifyInternalSharedCaptureRequest } from '../src/internal-shared-auth.js';
import { PostgresSharedRepository, type SharedRecord, type SharedRepository } from '@ryanos/db';

const canonical = 'https://www.instagram.com/p/DfyuklPvzI5/';
const evidence: SharedEvidence = {caption:'UI/UX ideas',frames:[{id:'frame-0',timestamp:2,image:'data:image/jpeg;base64,AA==',source:'scene'}],transcript:[],transcriptStatus:'silent',warnings:[],analysisStatus:'configuration_required'};
const validAnalysis = {summary:'A UI demonstration.',category:'idea',observations:[{text:'A button is shown',evidence:['frame-0']}],inferences:['May improve navigation'],suggestions:[{kind:'project',title:'Explore navigation',rationale:'Review the visual example',evidence:['frame-0']}],onScreenText:[{frameId:'frame-0',text:'Continue'}]};
const html = '<meta property="og:description" content="UI/UX ideas"><meta property="og:video" content="https://video.cdninstagram.com/example.mp4">';
const fetcher = vi.fn(async (_url:string,media:boolean) => ({bytes:Buffer.from(media?'media':html),contentType:media?'video/mp4':'text/html'}));
const extract = vi.fn(async()=>({frames:evidence.frames,transcript:[],transcriptStatus:'silent',warnings:[]}));
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
describe('Shared URL and media policy',()=>{
  it.each(['p','reel','reels','tv'])('canonicalizes %s and strips tracking',kind=>expect(normalizeInstagramUrl(`https://instagram.com/${kind}/DfyuklPvzI5/?igsh=secret#x`)).toEqual({shortcode:'DfyuklPvzI5',url:canonical}));
  it.each(['http://instagram.com/p/DfyuklPvzI5/','https://instagram.com.evil.test/p/DfyuklPvzI5/','https://user:pass@instagram.com/p/DfyuklPvzI5/','https://instagram.com:8080/p/DfyuklPvzI5/','https://instagram.com/accounts/login/','https://instagram.com/p/a%2fb/','https://127.0.0.1/p/DfyuklPvzI5/'])('rejects unsafe intake %s',url=>expect(()=>normalizeInstagramUrl(url)).toThrow());
  it.each(['http://v.cdninstagram.com/a','https://v.cdninstagram.com.evil/a','https://127.0.0.1/a','https://v.fbcdn.net:444/a','https://u:p@v.fbcdn.net/a','file:///etc/passwd'])('rejects media and redirects to %s',url=>expect(()=>allowedDownloadUrl(url,true)).toThrow());
  it('permits only expected HTTPS media hosts',()=>expect(allowedDownloadUrl('https://v.fbcdn.net/a?signature=x',true).hostname).toBe('v.fbcdn.net'));
  it.each(['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','224.0.0.1','::1','::ffff:127.0.0.1'])('blocks nonpublic addresses %s',ip=>expect(publicIPv4(ip)).toBe(false));
  it('allows public IPv4',()=>expect(publicIPv4('8.8.8.8')).toBe(true));
});
describe('Capture, evidence and analysis',()=>{
  it('extracts media from bounded public embedded JSON',()=>expect(parseInstagramHtml('<script type="application/json">{"data":{"video_url":"https://v.cdninstagram.com/movie.mp4"}}</script>').video).toBe('https://v.cdninstagram.com/movie.mp4'));
  it('never treats a cover image as complete reel evidence',async()=>{const result=await captureShared(canonical,{download:async(_u,media)=>({bytes:Buffer.from(media?'media':'<meta property="og:image" content="https://v.cdninstagram.com/cover.jpg">'),contentType:media?'image/jpeg':'text/html'}),extract,analyzer:{analyze:async()=>validAnalysis}});expect(result.status).toBe('partial');expect(result.result.warnings).toEqual(expect.arrayContaining([expect.stringContaining('cover only')]));});
  it('recognizes a login wall without bypassing it',()=>expect(()=>parseInstagramHtml('<title>Log in</title>')).toThrow('login_or_access_blocked'));
  it('keeps caption for missing media',async()=>{const result=await captureShared(canonical,{download:async()=>({bytes:Buffer.from('<meta property="og:description" content="SEO checklist">'),contentType:'text/html'})});expect(result.status).toBe('partial');expect(result.error).toBe('missing_media');expect(result.result.caption).toBe('SEO checklist');});
  it('retries throttle and network failures, not login walls',async()=>{for(const [code,retry] of [['instagram_throttled',true],['login_or_access_blocked',false]] as const){const result=await captureShared(canonical,{download:async()=>{throw new CaptureError(code,retry);}});expect(result.retry).toBe(retry);expect(result.error).toBe(code);}});
  it('retains frames for silent visual content without paid analysis',async()=>{const result=await captureShared(canonical,{download:fetcher,extract});expect(result.status).toBe('partial');expect(result.result.frames).toEqual(evidence.frames);expect(result.result.transcriptStatus).toBe('silent');expect(result.result.analysisStatus).toBe('configuration_required');});
  it('supports cited on-screen text and separate inferences using mocked analysis',async()=>{const analyze=vi.fn(async()=>validAnalysis);const result=await captureShared(canonical,{download:fetcher,extract,analyzer:{analyze}});expect(result.status).toBe('ready');expect(result.result.analysis).toEqual(validAnalysis);expect(analyze.mock.calls[0]?.[0]).not.toHaveProperty('tools');});
  it('does not promote partial transcripts to ready',async()=>{const result=await captureShared(canonical,{download:fetcher,extract:async()=>({...evidence,transcriptStatus:'partial'}),analyzer:{analyze:async()=>validAnalysis}});expect(result.status).toBe('partial');});
  it('keeps evidence when model output is invalid or hallucinates a reference',async()=>{const result=await captureShared(canonical,{download:fetcher,extract,analyzer:{analyze:async()=>({...validAnalysis,observations:[{text:'Invented',evidence:['frame-999']}]})}});expect(result.result.frames).toEqual(evidence.frames);expect(result.result.analysisStatus).toBe('failed');expect(result.result.analysis).toBeUndefined();});
  it('rejects task-writing output and oversized output',()=>{expect(()=>validateAnalysis({...validAnalysis,toolCalls:[{name:'create_task'}]},evidence)).toThrow();expect(()=>validateAnalysis({...validAnalysis,summary:'x'.repeat(50000)},evidence)).toThrow();});
  it('does not turn recipes or reference content into actions',()=>expect(validateAnalysis({...validAnalysis,category:'recipe'},evidence).suggestions).toEqual([]));
  it('bounds unresponsive analyzer execution',async()=>{const result=await captureShared(canonical,{download:fetcher,extract,timeoutMs:15,analyzer:{analyze:()=>new Promise(()=>{})}});expect(result.result.analysisStatus).toBe('failed');expect(result.result.frames).toEqual(evidence.frames);});
  it('retries media throttle while preserving caption',async()=>{const result=await captureShared(canonical,{download:async(u,m,l,s)=>{if(m)throw new CaptureError('instagram_throttled',true);return fetcher(u,m);}});expect(result.retry).toBe(true);expect(result.result.caption).toBe('UI/UX ideas');});
});
function repository(): SharedRepository {
  const records = new Map<string,SharedRecord>(); const tokens = new Map<string,string>();
  return {
    async save(user,shortcode,url){const old=[...records.values()].find(r=>r.user_id===user&&r.shortcode===shortcode);if(old)return old;const row={id:randomUUID(),user_id:user,shortcode,url,status:'queued',attempts:0,generation:0,result:{},manual:{},error:null,review:'unreviewed',created_at:new Date().toISOString(),updated_at:new Date().toISOString()};records.set(row.id,row);return row;},
    async list(user){return [...records.values()].filter(r=>r.user_id===user);},async get(user,id){const row=records.get(id);return row?.user_id===user?row:undefined;},
    async retry(user,id){return this.get(user,id);},async update(user,id,manual,review){const row=await this.get(user,id);if(!row)return;Object.assign(row,manual?{manual}:{},review?{review}:{});return row;},
    async token(user,hash){for(const [key,value] of tokens)if(value===user)tokens.delete(key);if(hash)tokens.set(hash,user);},async tokenUser(hash){return tokens.get(hash);},async process(){return false;}
  };
}
async function appFixture(){const repo=repository();const app=Fastify();registerSharedRoutes(app,{repository:repo,userId:r=>typeof r.headers['test-session']==='string'?r.headers['test-session']:undefined,origins:new Set(['https://ryanos.test'])});await app.ready();return {repo,app};}
describe('Shared HTTP auth and user isolation',()=>{
  it('requires a session, never accepts intake tokens for reads',async()=>{const {app}=await appFixture();try{expect((await app.inject('/v1/shared')).statusCode).toBe(401);expect((await app.inject({url:'/v1/shared',headers:{authorization:`Bearer ${'a'.repeat(43)}`}})).statusCode).toBe(401);}finally{await app.close();}});
  it('scopes tokens, deduplicates canonical links, rejects spoofing and revokes tokens',async()=>{const {app,repo}=await appFixture();try{
    const token=(await app.inject({method:'POST',url:'/v1/shared/tokens',headers:{'test-session':'alice'}})).json().token;
    const save=(url:string)=>app.inject({method:'POST',url:'/v1/shared/intake',headers:{authorization:`Bearer ${token}`},payload:{url}});
    const first=await save('https://instagram.com/reel/DfyuklPvzI5/?igsh=x');const second=await save(canonical);expect(first.statusCode).toBe(202);expect(first.json().id).toBe(second.json().id);
    expect((await repo.list('alice',0))).toHaveLength(1);expect((await repo.list('bob',0))).toHaveLength(0);
    const id=first.json().id;for(const method of ['GET','PATCH'] as const){expect((await app.inject({method,url:`/v1/shared/${id}`,headers:{'test-session':'bob'},...(method==='PATCH'?{payload:{review:'saved'}}:{})})).statusCode).toBe(404);}
    expect((await app.inject({method:'POST',url:'/v1/shared/intake',headers:{authorization:`Bearer ${token}`},payload:{url:canonical,userId:'bob'}})).statusCode).toBe(400);
    await app.inject({method:'DELETE',url:'/v1/shared/tokens',headers:{'test-session':'alice'}});expect((await save(canonical)).statusCode).toBe(401);
  }finally{await app.close();}});
  it('rejects untrusted origins and oversized intake',async()=>{const {app}=await appFixture();try{expect((await app.inject({method:'POST',url:'/v1/shared/tokens',headers:{'test-session':'alice',origin:'https://evil.test'}})).statusCode).toBe(403);expect((await app.inject({method:'POST',url:'/v1/shared/intake',payload:{url:'x'.repeat(5000)}})).statusCode).toBeGreaterThanOrEqual(400);}finally{await app.close();}});
  it('retains previous evidence when an authenticated retry cannot recapture media',async()=>{
    const key=Buffer.alloc(32,9);vi.stubEnv('RYANOS_MASTER_KEY',`hex:${key.toString('hex')}`);
    const repo=repository();const row=await repo.save('alice','DfyuklPvzI5',canonical);row.result={...evidence};
    repo.process=async(_id,_generation,run)=>{const outcome=await run(row);row.result=outcome.result;row.status=outcome.status;return outcome.retry;};
    const app=Fastify();registerSharedRoutes(app,{repository:repo,userId:()=>undefined,origins:new Set(),capture:async()=>({status:'failed',result:{},error:'login_or_access_blocked',retry:false})});
    try {const body={id:row.id,generation:0};const signed=signInternalSharedCaptureRequest(key,JSON.stringify(body));
      expect((await app.inject({method:'POST',url:'/v1/internal/shared/capture',payload:body})).statusCode).toBe(401);
      const response=await app.inject({method:'POST',url:'/v1/internal/shared/capture',payload:body,headers:{'x-ryanos-internal-timestamp':signed.timestamp,'x-ryanos-internal-signature':signed.signature}});expect(response.statusCode).toBe(200);expect(row.result.frames).toEqual(evidence.frames);expect(row.status).toBe('partial');
    } finally {await app.close();}
  });
  it('stores user-supplied fallback separately from captured evidence',async()=>{const {app,repo}=await appFixture();try{const row=await repo.save('alice','DfyuklPvzI5',canonical);const response=await app.inject({method:'PATCH',url:`/v1/shared/${row.id}`,headers:{'test-session':'alice'},payload:{manual:{caption:'My caption',transcript:'My transcript',notes:'Reference'}}});expect(response.statusCode).toBe(200);expect(response.json().manual.transcript).toBe('My transcript');expect(response.json().result).toEqual({});}finally{await app.close();}});
});
describe('Worker authentication and transactional persistence',()=>{
  it('binds internal signatures to payload, path purpose and time',()=>{const key=Buffer.alloc(32,3);const body=JSON.stringify({id:randomUUID(),generation:0});const signed=signInternalSharedCaptureRequest(key,body);expect(verifyInternalSharedCaptureRequest({masterKey:key,body,...signed})).toBe(true);expect(verifyInternalSharedCaptureRequest({masterKey:key,body:'{}',...signed})).toBe(false);expect(verifyInternalSharedCaptureRequest({masterKey:key,body,...signed,now:Date.now()+600000})).toBe(false);});
  it('commits intake and queue insertion together and rolls back queue failures',async()=>{
    const row={id:randomUUID(),generation:0};const calls:string[]=[];const client={release:vi.fn(),query:vi.fn(async(sql:string)=>{calls.push(sql);if(sql.startsWith('select count'))return {rows:[{n:0}]};if(sql.startsWith('insert into shared_content'))return {rows:[row]};if(sql.includes('add_job'))throw new Error('queue unavailable');return {rows:[]};})};
    const repo=new PostgresSharedRepository({connect:async()=>client} as never);await expect(repo.save(randomUUID(),'DfyuklPvzI5',canonical)).rejects.toThrow('queue unavailable');expect(calls.at(-1)).toBe('ROLLBACK');expect(calls.some(c=>c.includes("max_attempts := 3"))).toBe(true);expect(client.release).toHaveBeenCalled();
  });
  it('stops retrying on the third attempt and ignores stale generations',async()=>{
    const row={id:randomUUID(),status:'retrying',attempts:2,generation:0};const client={release:vi.fn(),query:vi.fn(async(sql:string)=>({rows:sql.startsWith('select *')?[row]:[]}))};const repo=new PostgresSharedRepository({connect:async()=>client} as never);
    const again=await repo.process(row.id,0,async()=>({status:'failed',result:{},error:'throttled',retry:true}));expect(again).toBe(false);expect(client.query.mock.calls.some(call=>call[0].includes('generation=$2'))).toBe(true);
  });
});
