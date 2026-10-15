// Run personally in a terminal only after the specific grant is approved. No secret argument/input.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
const helper=fileURLToPath(new URL('./bin/ryanos-task-keychain',import.meta.url));
const mode=process.argv[2],userId=process.argv[3];
function child(command,args,options={}) {
  return new Promise((resolve,reject)=>{
    const process=spawn(command,args,{...options}); let output='';
    process.stdout?.on('data',chunk=>{output+=chunk;if(output.length>16384)process.kill();});
    process.on('error',()=>reject(new Error('Operation unavailable')));
    process.on('close',code=>code===0?resolve(output):reject(new Error('Operation unconfirmed')));
    if(options.input!==undefined){process.stdin.end(options.input);}
  });
}
try {
  if(!process.stdin.isTTY || !['create','resume'].includes(mode) || (mode==='create'&&!/^[0-9a-f-]{36}$/i.test(userId??''))) throw new Error('User terminal required');
  const prompt=createInterface({input:process.stdin,output:process.stderr});
  const answer=await prompt.question('Grant 30-day create/read/search-all-items/completion-request access on Lenovo? Type GRANT RYANOS MAC ACCESS: '); prompt.close();
  if(answer!=='GRANT RYANOS MAC ACCESS') throw new Error('Cancelled');
  const raw=await child(helper,mode==='create'?['create',userId]:['metadata'],{stdio:['inherit','pipe','inherit']});
  const metadata=JSON.parse(raw); // Contains digest, IDs and expiry only.
  const stdout=await child('ssh',['-o','BatchMode=yes','-o','IdentitiesOnly=yes','lenovo','cd /opt/ryanos && timeout 30 docker compose -f docker-compose.server.yml exec -T api node scripts/task-integration/provision-server.mjs'],{stdio:['pipe','pipe','ignore'],input:JSON.stringify(metadata)});
  const result=JSON.parse(stdout);
  process.stdout.write(JSON.stringify({integrationId:result.integrationId,expiresAt:result.expiresAt,scopes:result.scopes,created:result.created})+'\n');
} catch { process.stderr.write('Provisioning was not confirmed. A Keychain entry may exist. Do not create another; inspect/resume the same identity after review.\n'); process.exitCode=1; }
