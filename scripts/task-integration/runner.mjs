import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { RyanOSTaskClient } from '../ryanos-task-client.mjs';
const exec = promisify(execFile);
export const apiBase = 'https://ryan-lenovo-desktop.taile89fa5.ts.net/api';
const keychainHelper = fileURLToPath(new URL('./bin/ryanos-task-keychain', import.meta.url));
const operations = new Set(['search','read-item','read-capture','capture','request-completion']);
const itemFields = ['id','kind','title','body','status','priority','dueAt','completedAt','deletedAt','revision','updatedAt'];
const pick = (object, fields) => object && Object.fromEntries(fields.filter(key => object[key] !== undefined).map(key=>[key,object[key]]));
const item = value => pick(value,itemFields);
const record = value => value && ({item:item(value.item),project:pick(value.project,['id','name','status'])??null,area:pick(value.area,['id','name','status'])??null,href:value.href});
export function sanitize(value) {
  const result=pick(value,['created','captureId','sourceId','suppressed','suppressionReason','itemId']) ?? {};
  if(value.item !== undefined) result.item=item(value.item)??null;
  if(value.records) result.records=value.records.map(record);
  if(value.record) result.record=record(value.record);
  if(value.request) result.request=pick(value.request,['id','status','itemRevision','requestedAt','decidedAt']);
  if(value.completionRequests) result.completionRequests=value.completionRequests.map(request=>pick(request,['id','status','requestedAt','decidedAt','evidence']));
  return result;
}
export async function runOperation(operation,input,{credentialProvider,fetchImpl,baseUrl=apiBase}={}) {
  if(!operations.has(operation)) throw new Error('Unsupported RyanOS operation');
  const credential=await credentialProvider();
  if(!credential?.token || !Number.isFinite(Date.parse(credential.expiresAt)) || Date.parse(credential.expiresAt)<=Date.now()) throw new Error('RyanOS credential unavailable or expired');
  const client=new RyanOSTaskClient({baseUrl,token:credential.token,fetchImpl});
  const result=await ({search:()=>client.search(input),'read-item':()=>client.readItem(input.id),'read-capture':()=>client.readCapture(input.sourceId),capture:()=>client.capture(input),'request-completion':()=>client.requestCompletion(input)})[operation]();
  // Never echo opaque server fields, credential-bearing URLs or a server echo of our credential.
  return JSON.parse(JSON.stringify(sanitize(result)).replaceAll(credential.token,'[redacted]'));
}
export async function keychainCredential() {
  try {
    const {stdout}=await exec(keychainHelper,['read-pipe'],{encoding:'utf8',maxBuffer:16384,timeout:60000});
    return JSON.parse(stdout);
  } catch { throw new Error('Keychain access unavailable; user handoff required'); }
}
export async function readInput(stream) {
  let text=''; for await(const chunk of stream) { text+=chunk; if(Buffer.byteLength(text)>16000) throw new Error('Input too large'); }
  return text.trim()?JSON.parse(text):{};
}
if(process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if(process.argv.length!==3) throw new Error('One operation required; JSON input on stdin');
    const input=await readInput(process.stdin);
    const result=await runOperation(process.argv[2],input,{credentialProvider:keychainCredential});
    process.stdout.write(JSON.stringify(result)+'\n');
  } catch { process.stderr.write('RyanOS operation unavailable. Check approved setup or request user handoff.\n'); process.exitCode=1; }
}
