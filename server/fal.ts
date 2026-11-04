import { mkdirSync, readFileSync, existsSync, writeFileSync, renameSync, readdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { InputError } from './runner.ts';
import { assertPublicMediaUrl } from './openrouter.ts';

type Obj = Record<string, any>;
export const FAL_MODELS = ['v3', 'v2.6'].flatMap(version => ['standard', 'pro'].map(tier => ({
  id: `fal-ai/kling-video/${version}/${tier}/motion-control`,
  name: `Kling ${version === 'v3' ? '3.0' : '2.6'} Motion Control · ${tier === 'pro' ? 'Pro' : 'Standard'}`,
  version, tier,
  url: `https://fal.ai/models/fal-ai/kling-video/${version}/${tier}/motion-control`,
})));
export type FalRun = { id: string; model: string; status: string; prompt: string; parameters: Obj; created: string; finished?: string; request_id?: string; status_url?: string; response_url?: string; queue?: number; seconds?: number; error?: string; outputs: { file: string; type: string }[] };
const object = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);
const done = (r: FalRun) => ['succeeded', 'failed', 'interrupted'].includes(r.status);
function atomic(path: string, body: unknown) {
  const tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(body, null, 2), { mode: 0o600 }); renameSync(tmp, path);
}
function media(value: unknown, kind: 'image' | 'video'): string {
  if (typeof value !== 'string' || !value) throw new InputError(`Choose a ${kind} file or HTTPS URL`);
  if (value.startsWith('data:')) {
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    const allowed = kind === 'image' ? ['image/png','image/jpeg','image/webp','image/gif','image/avif','image/heic','image/heif'] : ['video/mp4','video/webm','video/quicktime','video/x-m4v','image/gif'];
    if (!match || !allowed.includes(match[1]) || match[2].length % 4 !== 0 || Buffer.byteLength(match[2], 'base64') > 25 * 2 ** 20) throw new InputError(`${kind}: invalid file or file exceeds 25 MiB`);
    return value;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
    return url.href;
  } catch { throw new InputError(`${kind}: expected a public HTTPS URL or a file upload`); }
}
/** Queue URLs may carry credentials: pin them to the exact app and request path. */
export function falQueueUrl(value: unknown, request: string, status = false): string {
  if (typeof value !== 'string' || !/^[\w-]{1,100}$/.test(request)) throw new Error('Invalid fal request URL');
  const u = new URL(value);
  if (u.origin !== 'https://queue.fal.run' || u.username || u.password || u.search || u.hash || u.pathname !== `/fal-ai/kling-video/requests/${request}${status ? '/status' : ''}`) throw new Error('Untrusted fal queue URL');
  return u.href;
}

export class Fal {
  readonly dir: string;
  private config: { key?: string; defaults?: { model: string; orientation: string; keep_original_sound: boolean } };
  private fetcher: typeof fetch;
  private pending = new Map<string, Promise<void>>();
  private pause: (ms: number) => Promise<void>;
  constructor(dir: string, fetcher: typeof fetch = fetch, pause = (ms: number) => new Promise<void>(r => setTimeout(r, ms))) {
    this.dir = dir; this.fetcher = fetcher; this.pause = pause;
    mkdirSync(join(dir, 'runs'), { recursive: true, mode: 0o700 });
    const file = join(dir, 'settings.json');
    this.config = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    if (existsSync(file)) chmodSync(file, 0o600);
  }
  private key() { return this.config.key || process.env.FAL_KEY || ''; }
  status() { return { configured: !!this.key(), source: this.config.key ? 'settings' : process.env.FAL_KEY ? 'environment' : null, defaults: this.config.defaults ?? null }; }
  saveSettings(body: unknown) {
    if (!object(body)) throw new InputError('Expected fal settings');
    const next = { ...this.config };
    if (body.key !== undefined) {
      if (typeof body.key !== 'string' || (body.key && (!/^[\x21-\x7e]{8,512}$/.test(body.key) || body.key.startsWith('sk-or-')))) throw new InputError('Enter a fal.ai API key, not an OpenRouter key');
      if (body.key) next.key = body.key; else delete next.key;
    }
    if (body.defaults !== undefined) {
      const d = body.defaults;
      if (!object(d) || !FAL_MODELS.some(m => m.id === d.model) || !['image','video'].includes(d.orientation) || typeof d.keep_original_sound !== 'boolean') throw new InputError('Invalid fal defaults');
      next.defaults = { model: d.model, orientation: d.orientation, keep_original_sound: d.keep_original_sound };
    }
    atomic(join(this.dir, 'settings.json'), next); this.config = next;
    if (this.key()) this.resume();
    return this.status();
  }
  prepare(body: unknown) {
    if (!object(body) || !FAL_MODELS.some(m => m.id === body.model)) throw new InputError('Choose a supported fal Motion Control model');
    const orientation = body.character_orientation ?? 'video';
    const sound = body.keep_original_sound ?? true;
    if (!['image', 'video'].includes(orientation) || typeof sound !== 'boolean') throw new InputError('Invalid Motion Control options');
    if (body.prompt !== undefined && (typeof body.prompt !== 'string' || body.prompt.length > 2500)) throw new InputError('Prompt is limited to 2500 characters');
    return { model: body.model as string, input: { image_url: media(body.image_url, 'image'), video_url: media(body.video_url, 'video'), character_orientation: orientation, keep_original_sound: sound, ...(body.prompt ? { prompt: body.prompt } : {}) } };
  }
  list(): FalRun[] {
    return readdirSync(join(this.dir, 'runs')).map(id => this.get(id)).filter((r): r is FalRun => !!r).sort((a,b) => b.created.localeCompare(a.created));
  }
  get(id: string): FalRun | null {
    if (!/^[0-9a-f-]{36}$/.test(id)) return null;
    try { return JSON.parse(readFileSync(join(this.dir,'runs',id,'meta.json'),'utf8')); } catch { return null; }
  }
  file(id: string, name: string) { return this.get(id)?.outputs.some(o => o.file === name) ? join(this.dir,'runs',id,name) : null; }
  active() { return this.list().filter(r => !done(r)).length; }
  private save(run: FalRun) { atomic(join(this.dir,'runs',run.id,'meta.json'),run); }
  start(p: ReturnType<Fal['prepare']>) {
    if (!this.key()) throw new InputError('Save your fal.ai API key in Settings');
    const r: FalRun = { id: randomUUID(), model: p.model, status:'starting', prompt: p.input.prompt || '', parameters: { character_orientation: p.input.character_orientation, keep_original_sound: p.input.keep_original_sound }, created:new Date().toISOString(), outputs:[] };
    mkdirSync(join(this.dir,'runs',r.id),{mode:0o700}); this.save(r);
    const key = this.key();
    this.track(r,async () => {
      // Never automatically retry a submit: a failed response may still have created a billable job.
      const result = await (await this.request(`https://queue.fal.run/${p.model}`, key, p.input)).json() as Obj;
      if (typeof result.request_id !== 'string' || !/^[\w-]{1,100}$/.test(result.request_id)) throw new Error('Missing fal request ID; check fal Activity before retrying');
      r.request_id = result.request_id;
      // Persist the request ID even if an unexpected response URL needs investigation.
      this.save(r);
      r.status_url = falQueueUrl(result.status_url,r.request_id,true);
      r.response_url = falQueueUrl(result.response_url,r.request_id);
      r.status = 'queued'; this.save(r);
      await this.poll(r,key);
    },key);
    return r;
  }
  private track(run: FalRun, task: () => Promise<void>, key: string) {
    const work = task().catch(e => {
      run.status='failed';
      run.error=String(e?.message || e).split(key).join('[redacted]').replace(/data:[^\s"']+/g,'[file omitted]').slice(0,2500);
    }).finally(() => { if (done(run)) run.finished=new Date().toISOString(); this.save(run); this.pending.delete(run.id); });
    this.pending.set(run.id,work);
  }
  async settled(id: string) { await this.pending.get(id); return this.get(id); }
  private async request(url: string, key: string, body?: Obj) {
    const r = await this.fetcher(url,{method:body?'POST':'GET',headers:{authorization:`Key ${key}`,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,redirect:'error',signal:AbortSignal.timeout(120000)});
    if (!r.ok) {
      const b = await r.json().catch(()=>({})) as Obj;
      // fal validation errors may echo the entire input file. Extract messages only.
      const detail = typeof b.detail === 'string' ? b.detail : Array.isArray(b.detail) ? b.detail.map((d: Obj)=>d.msg || d.type || 'invalid input').join('; ') : b.error || 'Request failed';
      throw new Error(`fal.ai ${r.status}: ${typeof detail === 'string' ? detail : 'Request failed'}`);
    }
    return r;
  }
  private async download(url: string) {
    let u=new URL(url);
    for (let n=0;n<6;n++) {
      await assertPublicMediaUrl(u);
      const r=await this.fetcher(u,{redirect:'manual',signal:AbortSignal.timeout(10*60*1000)});
      if (r.status>=300 && r.status<400) { const location=r.headers.get('location'); if(!location)throw new Error('Missing fal media redirect'); u=new URL(location,u); continue; }
      if (!r.ok) throw new Error(`fal media download HTTP ${r.status}`);
      return r;
    }
    throw new Error('Too many fal media redirects');
  }
  private async poll(run: FalRun,key: string) {
    const id=run.request_id!;
    const status=falQueueUrl(run.status_url || `https://queue.fal.run/fal-ai/kling-video/requests/${id}/status`,id,true);
    const response=falQueueUrl(run.response_url || `https://queue.fal.run/fal-ai/kling-video/requests/${id}`,id);
    const deadline=Date.now()+24*60*60*1000;
    while(Date.now()<deadline) {
      let state: Obj;
      try { state=await(await this.request(status,key)).json(); }
      catch(e) { if(!/429|50[0234]|fetch failed|timeout/i.test(String((e as Error).message)))throw e; await this.pause(10000); continue; }
      if(state.error)throw new Error(String(state.error));
      if(state.status==='COMPLETED') {
        const result=await(await this.request(response,key)).json() as Obj;
        if(result.error)throw new Error(String(result.error));
        if(typeof result.video?.url!=='string')throw new Error('fal returned no video output');
        const media=await this.download(result.video.url);
        const bytes=new Uint8Array(await media.arrayBuffer());
        if(!bytes.length)throw new Error('fal returned empty video output');
        const type=(media.headers.get('content-type')||result.video.content_type||'video/mp4').split(';')[0];
        if(!['video/mp4','video/webm','application/octet-stream'].includes(type))throw new Error('fal output is not a video file');
        const file=type==='video/webm'?'output.webm':'output.mp4';
        writeFileSync(join(this.dir,'runs',run.id,file),bytes,{mode:0o600});
        run.outputs=[{file,type:type==='application/octet-stream'?'video/mp4':type}];
        run.seconds=state.metrics?.inference_time; run.status='succeeded'; return;
      }
      if(!['IN_QUEUE','IN_PROGRESS'].includes(state.status))throw new Error(`Unknown fal status: ${String(state.status)}`);
      run.status=state.status==='IN_QUEUE'?'queued':'running';
      run.queue=typeof state.queue_position==='number'?state.queue_position:undefined; this.save(run);
      await this.pause(3000);
    }
    throw new Error('fal request still pending after 24 hours; check fal Activity before retrying');
  }
  resume() {
    for(const run of this.list().filter(r=>!done(r) && !this.pending.has(r.id))) {
      if(!run.request_id) { run.status='interrupted'; run.error='Server restarted before request ID was saved. Check fal Activity before retrying; do not submit twice.'; this.save(run); continue; }
      if(!this.key()) { run.status='waiting_key'; this.save(run); continue; }
      const key=this.key(); this.track(run,()=>this.poll(run,key),key);
    }
  }
}
