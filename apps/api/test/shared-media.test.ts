import { describe, expect, it } from 'vitest';
import {readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {extractMedia} from '../src/shared-capture.js';
// Opt in with locally generated media; default suite has no Docker or FFmpeg requirement.
const fixtures=process.env.RYANOS_SHARED_MEDIA_FIXTURES;
describe.skipIf(!fixtures)('Shared real FFmpeg visual evidence',()=>{
  it('retains timestamped samples and a real scene change in silent video',async()=>{const result=await extractMedia(await readFile(`${fixtures}/visual.mp4`),AbortSignal.timeout(60000));expect(result.transcriptStatus).toBe('silent');expect(result.frames.length).toBeGreaterThanOrEqual(7);expect(result.frames.some(f=>f.source==='scene'&&Math.abs(f.timestamp-3)<0.3)).toBe(true);expect(new Set(result.frames.map(f=>f.image)).size).toBeGreaterThanOrEqual(2);expect(result.frames.every(f=>f.image.startsWith('data:image/jpeg;base64,')&&f.timestamp<6)).toBe(true);},65000);
  it('preserves images when audio transcription is partial',async()=>{const result=await extractMedia(await readFile(`${fixtures}/audio.mp4`),AbortSignal.timeout(60000),{transcribe:async()=>({complete:false,segments:[{start:0,end:1,text:'Partial fixture transcript'}]})});expect(result.transcriptStatus).toBe('partial');expect(result.frames.length).toBeGreaterThan(0);expect(result.transcript[0]?.text).toContain('Partial fixture');},65000);
  it('rejects duration overflow and cleans up temporary directories',async()=>{const before=(await readdir(tmpdir())).filter(f=>f.startsWith('ryanos-shared-'));await expect(extractMedia(await readFile(`${fixtures}/long.mp4`),AbortSignal.timeout(60000))).rejects.toThrow('media_duration_limit');await expect(extractMedia(Buffer.from('#EXTM3U\nfile:///etc/passwd'),AbortSignal.timeout(1000))).rejects.toThrow('unsupported_media_signature');expect((await readdir(tmpdir())).filter(f=>f.startsWith('ryanos-shared-'))).toEqual(before);},65000);
});
