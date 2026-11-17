import { describe, expect, it } from 'vitest';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WhisperCppTranscriber, parseWhisperOutput, sharedAdaptersFromEnv } from '../src/shared-adapters.js';
const valid={summary:'Visual example',category:'reference',observations:[{text:'A button',evidence:['frame-0']}],inferences:[],suggestions:[],onScreenText:[{frameId:'frame-0',text:'Continue'}]};
describe('Shared production adapters (mocked providers)',()=>{
  it('defaults to no external or local-model calls',()=>expect(sharedAdaptersFromEnv({})).toEqual({}));
  it('reports Codex vision unavailable without invoking any process or network',async()=>{
    const analyzer=sharedAdaptersFromEnv({RYANOS_SHARED_ANALYSIS:'codex-login'}).analyzer!;
    await expect(analyzer.analyze({instructions:'ignored',evidence:{caption:'data',transcript:[],transcriptStatus:'silent',frames:[],warnings:[],analysisStatus:'configuration_required'},signal:AbortSignal.timeout(1000),maxOutputCharacters:40000})).rejects.toMatchObject({code:'codex_tool_free_mode_unavailable'});
  });
  it('does not activate inference from unrelated AI credentials or old speculative endpoint settings',()=>expect(sharedAdaptersFromEnv({OPENAI_API_KEY:'fake',RYANOS_SHARED_ANALYZER_URL:'http://localhost:4111'})).toEqual({}));
  it('converts whisper.cpp millisecond offsets and rejects invalid intervals',()=>{expect(parseWhisperOutput({transcription:[{offsets:{from:1000,to:2500},text:' speech '}]})).toEqual({complete:true,segments:[{start:1,end:2.5,text:'speech'}]});expect(()=>parseWhisperOutput({transcription:[{offsets:{from:2500,to:1000},text:'bad'}]})).toThrow();});
  it('runs only the configured local speech binary with fixed arguments and removes temporary audio',async()=>{let directory='';const transcriber=new WhisperCppTranscriber('/usr/bin/whisper-cli','/models/reviewed-model.bin',async(command,args)=>{expect(command).toBe('/usr/bin/whisper-cli');expect(args.slice(0,2)).toEqual(['-m','/models/reviewed-model.bin']);const output=args[args.indexOf('-of')+1]!;directory=output.slice(0,output.lastIndexOf('/'));await writeFile(`${output}.json`,JSON.stringify({transcription:[{offsets:{from:0,to:1000},text:'fixture'}]}));});const wav=Buffer.alloc(44);wav.write('RIFF');wav.write('WAVE',8);expect((await transcriber.transcribe(wav,AbortSignal.timeout(1000))).segments).toHaveLength(1);await expect(access(directory)).rejects.toThrow();});
});
