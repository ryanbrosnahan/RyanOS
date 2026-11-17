import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
const state=vi.hoisted(()=>({lookup:vi.fn(),request:vi.fn()}));
vi.mock('node:dns/promises',()=>({lookup:state.lookup}));
vi.mock('node:https',()=>({request:state.request}));
import {download} from '../src/shared-fetch.js';
function response(status:number,headers:Record<string,string>,chunks:Buffer[]){state.request.mockImplementationOnce((_url,_options,cb)=>{const req=new EventEmitter() as EventEmitter & {setTimeout:()=>void;end:()=>void;destroy:(e:Error)=>void};req.setTimeout=()=>{};req.destroy=e=>req.emit('error',e);req.end=()=>{const res=Readable.from(chunks);Object.assign(res,{statusCode:status,headers});cb(res);};return req;});}
beforeEach(()=>{vi.resetAllMocks();state.lookup.mockResolvedValue([{address:'8.8.8.8',family:4}]);});
describe('Bounded pinned HTTPS capture',()=>{
  it('aborts a stalled DNS lookup within the capture deadline',async()=>{state.lookup.mockImplementation(()=>new Promise(()=>{}));await expect(download('https://v.fbcdn.net/x',true,100,AbortSignal.timeout(10))).rejects.toThrow('download_timeout');expect(state.request).not.toHaveBeenCalled();});
  it('pins validated DNS and sends no cookies or authorization',async()=>{response(200,{'content-type':'text/html'},[Buffer.from('public')]);expect((await download('https://www.instagram.com/p/Abcdef/',false,100,AbortSignal.timeout(1000))).bytes.toString()).toBe('public');const options=state.request.mock.calls[0]![1];expect(options.headers).not.toHaveProperty('cookie');expect(options.headers).not.toHaveProperty('authorization');const cb=vi.fn();options.lookup('ignored',{},cb);expect(cb).toHaveBeenCalledWith(null,'8.8.8.8',4);});
  it('rejects private DNS before requesting',async()=>{state.lookup.mockResolvedValue([{address:'127.0.0.1',family:4}]);await expect(download('https://v.fbcdn.net/x',true,100,AbortSignal.timeout(1000))).rejects.toThrow('unsafe_network_address');expect(state.request).not.toHaveBeenCalled();});
  it('rechecks every redirect and blocks local targets',async()=>{response(302,{location:'https://127.0.0.1/private'},[]);await expect(download('https://v.fbcdn.net/x',true,100,AbortSignal.timeout(1000))).rejects.toThrow('unsafe_media_url');expect(state.request).toHaveBeenCalledTimes(1);});
  it('enforces byte limit without content-length',async()=>{response(200,{'content-type':'video/mp4'},[Buffer.alloc(100),Buffer.alloc(100)]);await expect(download('https://v.fbcdn.net/x',true,150,AbortSignal.timeout(1000))).rejects.toThrow('download_size_limit');});
  it('rejects HTML masquerading as media',async()=>{response(200,{'content-type':'text/html'},[]);await expect(download('https://v.fbcdn.net/x',true,150,AbortSignal.timeout(1000))).rejects.toThrow('unexpected_content_type');});
  it('bounds redirect loops',async()=>{for(let i=0;i<4;i++)response(302,{location:'https://v.fbcdn.net/x'},[]);await expect(download('https://v.fbcdn.net/x',true,150,AbortSignal.timeout(1000))).rejects.toThrow('too_many_redirects');expect(state.request).toHaveBeenCalledTimes(4);});
});
