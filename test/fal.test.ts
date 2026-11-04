import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Fal, FAL_MODELS, falQueueUrl } from '../server/fal.ts';
const key='fake-fal-test-key';
const base='https://queue.fal.run/fal-ai/kling-video/requests/job-1';
const input={model:FAL_MODELS[0].id,image_url:'data:image/png;base64,AAAA',video_url:'data:video/mp4;base64,AAAA',keep_original_sound:false};
function fixture(t:any, handle?:(url:string,init?:RequestInit)=>Response|Promise<Response>) {
  const dir=mkdtempSync(join(tmpdir(),'freefield-fal-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const calls:{url:string;init?:RequestInit}[]=[];
  const fetcher:typeof fetch=async(u,init)=>{const url=String(u);calls.push({url,init});if(handle)return handle(url,init);if(init?.method==='POST')return Response.json({request_id:'job-1',status_url:base+'/status',response_url:base});if(url.endsWith('/status'))return Response.json({status:'COMPLETED'});if(url===base)return Response.json({video:{url:'https://8.8.8.8/output.mp4'}});return new Response('VIDEO',{headers:{'content-type':'video/mp4'}});};
  const service=new Fal(dir,fetcher,async()=>{});service.saveSettings({key});return{service,dir,calls,fetcher};
}
test('fal settings are private, independent and never reveal key; defaults preserve false',t=>{
 const{service,dir,fetcher}=fixture(t);service.saveSettings({defaults:{model:input.model,orientation:'video',keep_original_sound:false}});
 assert.equal(statSync(join(dir,'settings.json')).mode&0o777,0o600);assert.equal(JSON.stringify(service.status()).includes(key),false);
 assert.equal(new Fal(dir,fetcher).status().defaults?.keep_original_sound,false);assert.throws(()=>service.saveSettings({key:'sk-or-wrong-provider'}));service.saveSettings({key:''});assert.equal(readFileSync(join(dir,'settings.json'),'utf8').includes(key),false);
});
test('fal accepts local files and HTTPS references, rejects wrong model, MIME and invalid options',t=>{
 const{service}=fixture(t);assert.equal(FAL_MODELS.length,4);assert.equal(service.prepare(input).input.keep_original_sound,false);
 assert.equal(service.prepare({...input,video_url:'https://example.com/v.mp4'}).input.video_url,'https://example.com/v.mp4');
 for(const patch of [{model:'arbitrary/model'},{video_url:'http://example.com/v.mp4'},{image_url:'data:text/html;base64,AAAA'},{video_url:'data:video/mp4;base64,AA'},{character_orientation:'wrong'},{keep_original_sound:'false'},{prompt:'x'.repeat(2501)}])assert.throws(()=>service.prepare({...input,...patch}));
});
test('fal queue URLs pin credentials to exact app and request',()=>{
 assert.equal(falQueueUrl(base,'job-1'),base);
 for(const url of ['https://evil.example/fal-ai/kling-video/requests/job-1',base+'?x=1',base+'/extra',base.replace('job-1','job-2'),base.replace('https://','https://user:pass@')])assert.throws(()=>falQueueUrl(url,'job-1'));
});
test('fal submits once, keeps false, downloads video without credentials and omits source files from metadata',async t=>{
 const{service,calls}=fixture(t);const run=await service.settled(service.start(service.prepare(input)).id);assert.equal(run?.status,'succeeded');assert.equal(readFileSync(service.file(run!.id,'output.mp4')!,'utf8'),'VIDEO');
 assert.equal(calls.filter(c=>c.init?.method==='POST').length,1);assert.equal(JSON.parse(String(calls[0].init?.body)).keep_original_sound,false);assert.equal((calls[0].init?.headers as any).authorization,'Key '+key);assert.equal(calls.at(-1)?.init?.headers,undefined);
 assert.equal(JSON.stringify(run).includes('data:'),false);assert.equal(JSON.stringify(run).includes(key),false);assert.equal(service.file(run!.id,'../settings.json'),null);
});
test('fal never retries submission after uncertain network failure',async t=>{
 const{service,calls}=fixture(t,async()=>{throw new Error('fetch failed');});const run=await service.settled(service.start(service.prepare(input)).id);assert.equal(run?.status,'failed');assert.equal(calls.length,1);
});
test('fal rejects malicious queue URL before sending authenticated GET',async t=>{
 const{service,calls}=fixture(t,()=>Response.json({request_id:'job-1',status_url:'https://evil.example/status',response_url:base}));const run=await service.settled(service.start(service.prepare(input)).id);assert.equal(run?.status,'failed');assert.equal(run?.request_id,'job-1');assert.equal(calls.length,1);
});
test('fal errors redact keys and do not persist echoed file inputs',async t=>{
 const{service}=fixture(t,()=>Response.json({detail:[{msg:'bad '+key,input:input.video_url}]},{status:422}));const run=await service.settled(service.start(service.prepare(input)).id);assert.equal(run?.status,'failed');assert.equal(run?.error?.includes(key),false);assert.equal(JSON.stringify(run).includes('data:'),false);
});
test('fal restart follows saved job, never resubmits; missing request ID is explicit',async t=>{
 const{service,dir,calls}=fixture(t);const ids=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'];
 for(const[id,i]of ids.map((id,i)=>[id,i] as const)){mkdirSync(join(dir,'runs',id));writeFileSync(join(dir,'runs',id,'meta.json'),JSON.stringify({id,model:input.model,status:'starting',created:new Date().toISOString(),outputs:[],...(i===0?{request_id:'job-1'}:{})}));}
 service.resume();assert.equal((await service.settled(ids[0]))?.status,'succeeded');assert.equal(service.get(ids[1])?.status,'interrupted');assert.equal(calls.some(c=>c.init?.method==='POST'),false);assert.equal(calls[0].url,base+'/status');
});
test('fal waiting for key resumes only after credentials are saved',async t=>{
 const{service,dir,calls}=fixture(t);service.saveSettings({key:''});const id='00000000-0000-4000-8000-000000000003';mkdirSync(join(dir,'runs',id));writeFileSync(join(dir,'runs',id,'meta.json'),JSON.stringify({id,request_id:'job-1',status:'queued',created:new Date().toISOString(),outputs:[]}));service.resume();assert.equal(service.get(id)?.status,'waiting_key');assert.equal(calls.length,0);service.saveSettings({key});assert.equal((await service.settled(id))?.status,'succeeded');
});
test('fal blocks private output destinations and reports provider moderation failures',async t=>{
 for(const output of [{error:'moderation rejected'},{video:{url:'https://127.0.0.1/private'}}]){
 const{service,calls}=fixture(t,(url,init)=>init?.method==='POST'?Response.json({request_id:'job-1',status_url:base+'/status',response_url:base}):url.endsWith('/status')?Response.json({status:'COMPLETED'}):Response.json(output));const run=await service.settled(service.start(service.prepare(input)).id);assert.equal(run?.status,'failed');assert.equal(calls.length,3);
 }
});
