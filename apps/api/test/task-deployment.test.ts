import { execFileSync,spawnSync } from 'node:child_process';
import { mkdtempSync,writeFileSync,readFileSync,rmSync,chmodSync,openSync,closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe,it,expect } from 'vitest';
const root=fileURLToPath(new URL('../../../',import.meta.url));
describe('narrow deployment with local dummy command adapters only',()=>{
 it('plan has no remote effects; apply emits only guarded migration/application replacement',()=>{
  const dir=mkdtempSync(join(tmpdir(),'ryanos-deploy-test-'));
  try {
   const sha='b'.repeat(40),id='sha256:'+ 'a'.repeat(64);
   const stubs:Record<string,string>={
    git:`case "$1" in status) ;; rev-parse) echo ${sha};; *) exit 0;; esac`,
    docker:`case "$*" in *org.opencontainers.image.revision*) echo ${sha};; *io.ryanos.tree-status*) echo release;; *Architecture*) echo amd64;; *image\\ inspect*) echo ${id};; *image\\ save*) echo dummy-image;; *) exit 9;; esac`,
    scp:'exit 0',ssh:`cat > '${join(dir,'remote.sh')}'`
   };
   for(const [name,body] of Object.entries(stubs)){const path=join(dir,name);writeFileSync(path,'#!/bin/bash\nset -eu\n'+body+'\n');chmodSync(path,0o700);}
   const env={...process.env,PATH:dir+':'+process.env.PATH};
   expect(execFileSync('bash',['scripts/deploy-task-release.sh','plan'],{cwd:root,env,encoding:'utf8'})).toContain('No automatic rollback');
   execFileSync('bash',['scripts/deploy-task-release.sh','apply','reviewed-release'],{cwd:root,env});
   const remote=readFileSync(join(dir,'remote.sh'),'utf8'); execFileSync('bash',['-n',join(dir,'remote.sh')]);
   expect(remote).toContain('run --rm --no-deps migrate'); expect(remote).toContain('up -d --no-build --no-deps api web worker');
   expect(remote).not.toMatch(/bridge.service|ensure-postgres-docker-auth|ryanos_retire_images|--remove-orphans|docker compose.*down/);
   expect(remote).toContain('sha256sum'); expect(remote).toContain('RootFS.Layers');
   expect(remote).toContain('pg_dump -Fc'); expect(remote).toContain('install -m 0600'); expect(remote).toContain('mkdir -m 0700');
   expect(remote.indexOf('pg_dump -Fc')).toBeLessThan(remote.indexOf('run --rm --no-deps migrate'));
   execFileSync('bash',['scripts/rollback-task-release.sh',sha,id],{cwd:root,env});
   const rollback=readFileSync(join(dir,'remote.sh'),'utf8'); execFileSync('bash',['-n',join(dir,'remote.sh')]);
   expect(rollback).toContain('for attempt in {1..30}'); expect(rollback).toContain('ryanos_guard_is_clear'); expect(rollback).not.toMatch(/db:migrate|DROP TABLE|pg_restore|docker compose.*down/);
  } finally {rmSync(dir,{recursive:true,force:true});}
 });
 it.skipIf(process.platform!=='darwin')('refuses real credential generation without a user terminal and refuses credential file output',()=>{
  const dir=mkdtempSync(join(tmpdir(),'ryanos-native-test-')); const helper=join(dir,'keychain-helper');
  try {
   execFileSync('swiftc',['-O','-module-cache-path',join(dir,'cache'),join(root,'scripts/task-integration/keychain.swift'),'-o',helper],{stdio:'pipe',timeout:60000});
   expect(JSON.parse(execFileSync(helper,['self-test'],{encoding:'utf8'}))).toEqual({ok:true,keychainAccessed:false});
   const refusal=spawnSync(helper,['create','00000000-0000-4000-8000-000000000001'],{input:'CREATE RYANOS CREDENTIAL\n',encoding:'utf8'});
   expect(refusal.status).toBe(1); expect(refusal.stderr).toContain('User-operated terminal');
   const path=join(dir,'empty-output');const fd=openSync(path,'w',0o600);
   try { const result=spawnSync(helper,['read-pipe'],{stdio:['ignore',fd,'pipe'],encoding:'utf8'}); expect(result.status).toBe(1); expect(result.stderr).toContain('terminal/file output refused'); expect(readFileSync(path,'utf8')).toBe(''); }
   finally {closeSync(fd);}
  } finally {rmSync(dir,{recursive:true,force:true});}
 },90000);
});
