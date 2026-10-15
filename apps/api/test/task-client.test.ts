import { describe, it, expect, vi } from 'vitest';
// @ts-expect-error dependency-free client intentionally ships as native ESM
import { RyanOSTaskClient } from '../../../scripts/ryanos-task-client.mjs';
describe('task API client', () => {
  it('uses scoped auth, omits cookies and rejects redirects without exposing server errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ok:false,status:403,json:()=>({secret:'must not display'})});
    const client = new RyanOSTaskClient({baseUrl:'https://example.test/api',token:'synthetic_'.padEnd(40,'x'),fetchImpl});
    await expect(client.search({query:'James tax',statuses:['done']})).rejects.toThrow('RyanOS request failed (403)');
    const [url,init] = fetchImpl.mock.calls[0]!;
    expect(url).toContain('statuses=done'); expect(init.credentials).toBe('omit'); expect(init.redirect).toBe('error');
    expect(client.complete).toBeUndefined(); expect(client.approve).toBeUndefined();
  });
  it('rejects insecure remote URLs and does not leak a failing fetch error', async () => {
    expect(()=>new RyanOSTaskClient({baseUrl:'http://remote.test',token:'x'.repeat(40)})).toThrow('HTTPS');
    const client=new RyanOSTaskClient({baseUrl:'http://127.0.0.1:4107',token:'x'.repeat(40),fetchImpl:async()=>{throw new Error('sensitive');}});
    await expect(client.readCapture('chat:1')).rejects.toThrow('RyanOS connection failed');
  });
});
