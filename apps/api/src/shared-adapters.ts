import { CaptureError } from './shared-fetch.js';
import { execFile } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';
import { type SharedAnalyzer, type SharedTranscriber } from './shared-capture.js';

/** Explicitly unavailable: CLI feature switches/read-only mode do not prove no tools. */
export class UnavailableCodexVisionAnalyzer implements SharedAnalyzer {
  readonly code = 'codex_tool_free_mode_unavailable';
  async analyze(_input: Parameters<SharedAnalyzer['analyze']>[0]): Promise<never> {
    throw new CaptureError(this.code);
  }
}
export type SpeechCommand = (command:string,args:string[],signal:AbortSignal)=>Promise<void>;
const runSpeech:SpeechCommand=(command,args,signal)=>new Promise((resolve,reject)=>{
  execFile(command,args,{signal,timeout:90_000,killSignal:'SIGKILL',maxBuffer:256_000,env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'}},error=>error?reject(new Error('Local speech failed')):resolve());
});
export function parseWhisperOutput(value:unknown){
  const parsed=z.object({transcription:z.array(z.object({offsets:z.object({from:z.number().min(0).max(180_000),to:z.number().min(0).max(180_000)}),text:z.string().max(2000)})).max(300)}).parse(value);
  const segments=parsed.transcription.map(item=>({start:item.offsets.from/1000,end:item.offsets.to/1000,text:item.text.trim()}));
  if(segments.some((s,i)=>s.end<s.start||(i>0&&s.start<segments[i-1]!.start)))throw new Error('Invalid speech timestamps');
  // Successful exit only; downstream capture also validates against actual media duration.
  return {complete:true,segments};
}
export class WhisperCppTranscriber implements SharedTranscriber {
  constructor(private command:string,private model:string,private run:SpeechCommand=runSpeech){if(!isAbsolute(command)||!isAbsolute(model))throw new Error('Explicit local speech paths required');}
  async transcribe(audio:Buffer,signal:AbortSignal){
    if(audio.length>6_000_000||audio.subarray(0,4).toString()!=='RIFF'||audio.subarray(8,12).toString()!=='WAVE')throw new Error('Invalid bounded WAV');
    const dir=await mkdtemp(join(tmpdir(),'ryanos-speech-'));
    try{const file=join(dir,'audio.wav');const output=join(dir,'transcript');await writeFile(file,audio,{mode:0o600});
      await this.run(this.command,['-m',this.model,'-f',file,'-oj','-of',output,'-t','2','-np'],signal);
      const result=await readFile(`${output}.json`);if(result.length>80_000)throw new Error('Speech output limit');return parseWhisperOutput(JSON.parse(result.toString()));
    }finally{await rm(dir,{recursive:true,force:true});}
  }
}
export function sharedAdaptersFromEnv(env:NodeJS.ProcessEnv=process.env):{analyzer?:SharedAnalyzer;transcriber?:SharedTranscriber}{
  const adapters:{analyzer?:SharedAnalyzer;transcriber?:SharedTranscriber}={};
  if(env.RYANOS_SHARED_ANALYSIS==='codex-login')adapters.analyzer=new UnavailableCodexVisionAnalyzer();
  if(env.RYANOS_SHARED_WHISPER_COMMAND&&env.RYANOS_SHARED_WHISPER_MODEL)adapters.transcriber=new WhisperCppTranscriber(env.RYANOS_SHARED_WHISPER_COMMAND,env.RYANOS_SHARED_WHISPER_MODEL);
  return adapters;
}
