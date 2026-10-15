import { describe,it,expect,vi } from 'vitest';
// @ts-expect-error native ESM client module
import { runOperation, sanitize } from '../../../scripts/task-integration/runner.mjs';
// @ts-expect-error native ESM provisioning module
import { validateGrant } from '../../../scripts/task-integration/provision-server.mjs';
const token='synthetic_dummy_only_00000000000000000000';
const credentialProvider=async()=>({token,expiresAt:'2050-01-01T00:00:00Z'});
describe('Keychain runner boundary with dummy credentials only',()=>{
  it('redacts credential echoes, removes metadata/identity and omits cookies',async()=>{
    const fetchImpl=vi.fn().mockResolvedValue({ok:true,json:async()=>({records:[{item:{id:'id',title:'Dummy '+token,body:'See '+token,status:'open',userId:'private',metadata:{opaque:'omit'}},project:null,area:null,href:'/tasks/id'}],unexpected:token})});
    const result=await runOperation('search',{query:'dummy'},{credentialProvider,fetchImpl});
    expect(JSON.stringify(result)).not.toContain(token); expect(result.records[0].item.metadata).toBeUndefined(); expect(result.records[0].item.userId).toBeUndefined();
    expect(fetchImpl.mock.calls[0]![1]).toMatchObject({credentials:'omit',redirect:'error'});
  });
  it('refuses completion approval and fails before credential access for unknown operations',async()=>{
    const get=vi.fn(credentialProvider);
    await expect(runOperation('complete',{}, {credentialProvider:get})).rejects.toThrow('Unsupported'); expect(get).not.toHaveBeenCalled();
  });
  it('rejects expired credentials and does not echo server failures',async()=>{
    const fetchImpl=vi.fn();
    await expect(runOperation('search',{}, {credentialProvider:async()=>({token,expiresAt:'2000-01-01'}),fetchImpl})).rejects.toThrow('expired'); expect(fetchImpl).not.toHaveBeenCalled();
    const failure=async()=>({ok:false,status:403,text:async()=>token});
    await expect(runOperation('search',{}, {credentialProvider,fetchImpl:failure})).rejects.toThrow('RyanOS request failed (403)');
  });
  it('limits completion response to request identity/state and validates bounded grants',()=>{
    expect(sanitize({request:{id:'r',status:'pending',token,secret:'not allowed'}})).toEqual({request:{id:'r',status:'pending'}});
    const grant={integrationId:'00000000-0000-4000-8000-000000000001',userId:'00000000-0000-4000-8000-000000000002',tokenHash:'0'.repeat(64),expiresAt:new Date(Date.now()+86400000).toISOString()};
    expect(validateGrant(grant)).toEqual(grant);
    expect(()=>validateGrant({...grant,token})).toThrow();
    expect(()=>validateGrant({...grant,expiresAt:new Date(Date.now()+31*86400000).toISOString()})).toThrow();
  });
});
