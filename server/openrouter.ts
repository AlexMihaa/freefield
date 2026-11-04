// OpenRouter is independent of ComfyUI: no GPU contacts, restarts or workflow rewrites.
import { mkdirSync, readFileSync, writeFileSync, renameSync, readdirSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { InputError } from './runner.ts';

type Obj = Record<string, any>;
export type Field = { type: string; values?: (string | number)[]; min?: number; max?: number; integer?: boolean; help?: string };
export type CloudModel = { id: string; name: string; kind: string; description: string; fields: Record<string, Field>; inputs: string[]; pricing: unknown; raw: Obj };
export type CloudRun = { id: string; model: string; kind: string; prompt: string; parameters: Obj; status: string; created: string; finished?: string; job?: string; error?: string; usage?: unknown; text?: string; outputs: { file: string; type: string }[] };
const API = 'https://openrouter.ai';
const PATHS: Record<string, string> = { image: '/api/v1/images', video: '/api/v1/videos', speech: '/api/v1/audio/speech', transcription: '/api/v1/audio/transcriptions', text: '/api/v1/chat/completions', audio: '/api/v1/chat/completions', embeddings: '/api/v1/embeddings', rerank: '/api/v1/rerank', decisions: '/api/alpha/decisions', extractions: '/api/alpha/extractions' };
const terminal = (r: CloudRun) => ['succeeded', 'failed', 'interrupted'].includes(r.status);
const object = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);
function atomic(file: string, data: unknown) {
  const tmp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
}

export function modelFields(raw: Obj, kind: string): Record<string, Field> {
  const fields: Record<string, Field> = {};
  const range = (min: number, max: number, integer = false): Field => ({ type: 'range', min, max, integer });
  const en = (values: (string | number)[]): Field => ({ type: 'enum', values });
  if (kind === 'image' && object(raw.supported_parameters)) {
    for (const [k, d] of Object.entries(raw.supported_parameters) as [string, Obj][]) {
      if (['input_references', 'stream'].includes(k)) continue;
      // A boolean capability means "this parameter is supported", not that its value is boolean.
      fields[k] = d.type === 'boolean' ? { type: k === 'seed' ? 'integer' : 'string' } : { ...d, integer: ['n', 'output_compression', 'seed'].includes(k) } as Field;
    }
  }
  if (kind === 'video') {
    for (const [key, source] of Object.entries({ duration: 'supported_durations', resolution: 'supported_resolutions', aspect_ratio: 'supported_aspect_ratios', size: 'supported_sizes', upscale_factor: 'upscale_factor', creativity: 'creativity' })) {
      const v = raw[source];
      if (Array.isArray(v) && v.length) fields[key] = en(v);
      else if (object(v)) fields[key] = { type: 'range', ...v } as Field;
    }
    if (raw.generate_audio === true) fields.generate_audio = { type: 'boolean' };
    if (raw.seed === true) fields.seed = { type: 'integer' };
  }
  if (kind === 'speech') {
    fields.voice = raw.supported_voices?.length ? en(raw.supported_voices) : { type: 'string' };
    fields.instructions = { type: 'string' };
    // Common API options: adapters may reject a format or speed; do not invent per-model capabilities.
    fields.response_format = { ...en(['mp3', 'wav', 'flac', 'opus', 'aac', 'pcm']), help: 'provider' };
    fields.speed = { ...range(0.25, 4), help: 'provider' };
  }
  if (kind === 'transcription') {
    fields.language = { type: 'string' };
    fields.response_format = { ...en(['json', 'verbose_json']), help: 'provider' };
    fields.temperature = { ...range(0, 1), help: 'provider' };
  }
  if (kind === 'text' || kind === 'audio') {
    const supported: string[] = raw.supported_parameters ?? [];
    for (const [k, d] of Object.entries({ temperature: range(0, 2), top_p: range(0, 1), max_tokens: range(1, raw.top_provider?.max_completion_tokens || raw.context_length || 4096, true), seed: { type: 'integer' }, frequency_penalty: range(-2, 2), presence_penalty: range(-2, 2) })) {
      if (supported.includes(k)) fields[k] = d;
    }
    if (supported.includes('reasoning') && raw.reasoning?.supported_efforts?.length) fields.reasoning_effort = en(raw.reasoning.supported_efforts);
    if (kind === 'audio') {
      fields.voice = raw.supported_voices?.length ? en(raw.supported_voices) : { type: 'string' };
      fields.format = { ...en(['wav', 'mp3', 'flac', 'opus', 'pcm16']), help: 'provider' };
    }
  }
  if (kind === 'embeddings') fields.dimensions = { type: 'integer', min: 1, help: 'provider' };
  if (kind === 'rerank') fields.top_n = { type: 'integer', min: 1 };
  return fields;
}
export function validateParameters(model: CloudModel, params: unknown): Obj {
  if (!object(params)) throw new InputError('Expected parameter object');
  const clean: Obj = {};
  for (const [key, value] of Object.entries(params)) {
    const d = model.fields[key];
    if (!d) throw new InputError(`Unsupported parameter: ${key}`);
    if (d.type === 'enum') {
      if (!d.values?.includes(value)) throw new InputError(`${key}: choose a supported value`);
    } else if (['integer', 'range', 'number'].includes(d.type)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || ((d.type === 'integer' || d.integer) && !Number.isInteger(value)) || (d.min !== undefined && value < d.min) || (d.max !== undefined && value > d.max)) throw new InputError(`${key}: invalid number`);
    } else if (d.type === 'boolean') {
      if (typeof value !== 'boolean') throw new InputError(`${key}: expected boolean`);
    } else if (typeof value !== 'string' || value.length > 10000) throw new InputError(`${key}: expected text`);
    clean[key] = value;
  }
  if (clean.size !== undefined && (clean.resolution !== undefined || clean.aspect_ratio !== undefined)) throw new InputError('Use size OR resolution/aspect_ratio');
  return clean;
}

export class OpenRouter {
  readonly dir: string;
  private settingsFile: string;
  private settings: { key?: string; defaults?: Record<string, { model: string; parameters: Obj }> };
  private cached?: { at: number; models: CloudModel[]; warnings: string[] };
  private fetching?: Promise<{ models: CloudModel[]; warnings: string[] }>;
  private pending = new Map<string, Promise<void>>();
  private fetcher: typeof fetch;
  constructor(dir: string, fetcher: typeof fetch = fetch) {
    this.dir = dir;
    this.settingsFile = join(dir, 'settings.json');
    this.fetcher = fetcher;
    mkdirSync(join(dir, 'runs'), { recursive: true, mode: 0o700 });
    this.settings = existsSync(this.settingsFile) ? JSON.parse(readFileSync(this.settingsFile, 'utf8')) : {};
    if (existsSync(this.settingsFile)) chmodSync(this.settingsFile, 0o600);
  }
  private key() { return this.settings.key || process.env.OPENROUTER_API_KEY || ''; }
  status() { return { configured: !!this.key(), source: this.settings.key ? 'settings' : process.env.OPENROUTER_API_KEY ? 'environment' : null, defaults: this.settings.defaults ?? {} }; }
  saveSettings(body: unknown) {
    if (!object(body)) throw new InputError('Expected settings object');
    const next = { ...this.settings };
    if (body.key !== undefined) {
      if (typeof body.key !== 'string' || (body.key && (!/^sk-or-[\w-]+$/.test(body.key) || body.key.length > 512))) throw new InputError('Invalid OpenRouter key');
      if (body.key) next.key = body.key; else delete next.key;
    }
    // Defaults are stored only from validated submissions via saveDefault below.
    atomic(this.settingsFile, next);
    this.settings = next;
    this.cached = undefined;
    return this.status();
  }
  saveDefault(model: CloudModel, parameters: Obj) {
    const next = { ...this.settings, defaults: { ...this.settings.defaults, [model.kind]: { model: model.id, parameters } } };
    atomic(this.settingsFile, next);
    this.settings = next;
    return this.status();
  }
  private redact(s: string) { const k = this.key(); return (k ? s.split(k).join('[redacted]') : s).replace(/sk-or-[\w-]+/g, '[redacted]'); }
  private async api(path: string, key = this.key(), body?: Obj, timeout = 120000): Promise<Response> {
    if (!/^\/api\/(v1|alpha)\//.test(path) || path.includes('..') || /[?#\\]/.test(path)) throw new Error('Invalid OpenRouter path');
    const res = await this.fetcher(API + path, { method: body ? 'POST' : 'GET', headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual', signal: AbortSignal.timeout(timeout) });
    if (!res.ok) {
      if (res.status >= 300 && res.status < 400 && path.endsWith('/content')) return res;
      const err = await res.json().catch(() => ({})) as Obj;
      throw new Error(this.redact(`OpenRouter ${res.status}: ${err.error?.message || res.statusText}`));
    }
    return res;
  }
  async check() {
    if (!this.key()) throw new InputError('Set an OpenRouter key in Settings');
    const r = await (await this.api('/api/v1/key')).json() as Obj;
    if (!object(r.data)) throw new Error('Invalid OpenRouter key-check response');
    if (r.data.is_management_key || r.data.is_provisioning_key) throw new InputError('Management API keys cannot generate media. Create a regular API key at openrouter.ai/settings/keys and replace it in Settings.');
    return { ok: true, limit_remaining: r.data.limit_remaining ?? null };
  }
  async catalog(refresh = false) {
    if (!refresh && this.cached && Date.now() - this.cached.at < 5 * 60 * 1000) return this.cached;
    if (this.fetching) return this.fetching;
    this.fetching = (async () => {
      const results = await Promise.allSettled(['/api/v1/models?output_modalities=all', '/api/v1/images/models', '/api/v1/videos/models'].map(async (path) => {
        // Only this fixed discovery query bypasses api()'s no-query rule.
        const res = await this.fetcher(API + path, { headers: this.key() ? { authorization: `Bearer ${this.key()}` } : {}, redirect: 'error', signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error(`Catalog ${path.split('?')[0]}: HTTP ${res.status}`);
        return (await res.json() as Obj).data as Obj[];
      }));
      const models: CloudModel[] = [], warnings: string[] = [];
      for (const [i, result] of results.entries()) {
        if (result.status === 'rejected') { warnings.push(String(result.reason.message)); continue; }
        for (const entry of result.value) {
          const general = results[0].status === 'fulfilled' ? results[0].value.find(m => m.id === entry.id) : undefined;
          const raw = i === 0 ? entry : { ...general, ...entry };
          const kinds = i === 1 ? ['image'] : i === 2 ? ['video'] : Object.entries(PATHS).filter(([k, p]) => !['image', 'video'].includes(k) && raw.endpoints?.includes(p) && (k !== 'audio' || raw.architecture?.output_modalities?.includes('audio')) && (k !== 'text' || raw.architecture?.output_modalities?.includes('text'))).map(([k]) => k);
          for (const kind of kinds) models.push({ id: raw.id, name: raw.name || raw.id, kind, description: raw.description || '', fields: modelFields(raw, kind), inputs: raw.architecture?.input_modalities ?? ['text', ...(kind === 'video' ? ['image'] : [])], pricing: raw.pricing_skus ?? raw.pricing ?? null, raw });
        }
      }
      if (!models.length) throw new Error(warnings.join('; ') || 'Empty OpenRouter catalog');
      this.cached = { at: Date.now(), models, warnings };
      return this.cached;
    })();
    try { return await this.fetching; } finally { this.fetching = undefined; }
  }
  async model(id: string, kind: string) {
    const m = (await this.catalog()).models.find(m => m.id === id && m.kind === kind);
    if (!m) throw new InputError('Model unavailable for this operation; refresh catalog');
    return m;
  }
  async endpoints(model: CloudModel) {
    if (!/^[\w.:-]+\/[\w.:-]+$/.test(model.id)) throw new InputError('Invalid model ID');
    const prefix = model.kind === 'image' ? 'images/models' : 'models';
    return (await this.api(`/api/v1/${prefix}/${model.id.split('/').map(encodeURIComponent).join('/')}/endpoints`)).json();
  }
  list(): CloudRun[] {
    return readdirSync(join(this.dir, 'runs')).filter(n => /^[\da-f-]{36}$/.test(n)).flatMap(id => { try { return [this.get(id)!]; } catch { return []; } }).filter(Boolean).sort((a, b) => b.created.localeCompare(a.created));
  }
  get(id: string): CloudRun | null {
    if (!/^[\da-f-]{36}$/.test(id)) return null;
    try { return JSON.parse(readFileSync(join(this.dir, 'runs', id, 'meta.json'), 'utf8')); } catch { return null; }
  }
  file(id: string, name: string) {
    const r = this.get(id);
    return r?.outputs.some(o => o.file === name) ? join(this.dir, 'runs', id, name) : null;
  }
  private save(run: CloudRun) { atomic(join(this.dir, 'runs', run.id, 'meta.json'), run); }
  active() { return this.list().filter(r => !terminal(r)).length; }
  private output(run: CloudRun, bytes: Uint8Array, mime: string) {
    const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'video/mp4': 'mp4', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/flac': 'flac', 'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/aac': 'aac', 'audio/pcm': 'pcm', 'audio/pcm16': 'pcm' };
    const type = mime.split(';')[0];
    const file = `output-${run.outputs.length + 1}.${extensions[type] || 'bin'}`;
    writeFileSync(join(this.dir, 'runs', run.id, file), bytes, { mode: 0o600 });
    run.outputs.push({ file, type });
  }
  async prepare(body: unknown) {
    if (!object(body) || typeof body.model !== 'string' || typeof body.kind !== 'string' || typeof body.prompt !== 'string' || body.prompt.length > 100000) throw new InputError('Invalid generation request');
    const model = await this.model(body.model, body.kind);
    const params = validateParameters(model, body.parameters ?? {});
    if (!body.prompt.trim() && !['transcription', 'video'].includes(model.kind)) throw new InputError('Enter a prompt');
    if (body.advanced !== undefined && !object(body.advanced)) throw new InputError('Advanced options must be a JSON object');
    // Full native request options, but no ability to replace routing, model or required streaming protocol.
    const advanced = body.advanced ?? {};
    for (const k of ['model', 'stream', 'modalities', 'callback_url']) if (k in advanced) throw new InputError(`Advanced options cannot override ${k}`);
    const payload: Obj = { ...params, ...advanced, model: model.id };
    if (model.kind === 'image' || model.kind === 'video') payload.prompt = body.prompt;
    if (model.kind === 'speech') payload.input ??= body.prompt;
    if (model.kind === 'transcription' && !payload.input_audio) throw new InputError('Upload an audio file');
    if (model.kind === 'embeddings') payload.input ??= body.prompt.split('\n').filter(Boolean);
    if (['decisions', 'extractions'].includes(model.kind)) {
      payload.state ??= { text: body.prompt };
      const schemaKey = model.kind === 'decisions' ? 'questions' : 'fields';
      if (!object(payload[schemaKey]) || !Object.keys(payload[schemaKey]).length) throw new InputError(`Add a ${schemaKey} schema`);
    }
    if (model.kind === 'rerank') {
      payload.query ??= body.prompt;
      if (!Array.isArray(payload.documents) || !payload.documents.length) throw new InputError('Add documents to rerank');
    }
    if (model.kind === 'text' || model.kind === 'audio') {
      payload.messages ??= [{ role: 'user', content: body.prompt }];
      if (payload.reasoning_effort) { payload.reasoning = { effort: payload.reasoning_effort }; delete payload.reasoning_effort; }
      payload.stream = model.kind === 'audio';
      if (model.kind === 'audio') { payload.modalities = ['text', 'audio']; payload.audio = { voice: payload.voice, format: payload.format || 'wav' }; delete payload.voice; delete payload.format; }
    }
    if (model.kind === 'video' && !body.prompt.trim() && !payload.input_references?.length && !payload.frame_images?.length) throw new InputError('Enter a prompt or attach source media');
    if (model.kind === 'image' && payload.input_references !== undefined) {
      const refs = payload.input_references;
      const cap = model.raw.supported_parameters?.input_references;
      if (!Array.isArray(refs) || !cap || (cap.max !== undefined && refs.length > cap.max)) throw new InputError('Reference images exceed this model capability');
    }
    if (model.kind === 'video' && payload.input_references !== undefined) {
      if (!Array.isArray(payload.input_references)) throw new InputError('input_references must be an array');
      for (const ref of payload.input_references) {
        if (!object(ref) || !['image_url', 'video_url', 'audio_url'].includes(ref.type) || !object(ref[ref.type]) || typeof ref[ref.type].url !== 'string') throw new InputError('Invalid video reference');
        if (ref.type === 'image_url' && /^data:image\/(png|jpeg|webp|gif);base64,/.test(ref.image_url.url)) continue;
        let url: URL;
        try { url = new URL(ref[ref.type].url); } catch { throw new InputError('Video references require a public HTTPS URL'); }
        if (url.protocol !== 'https:' || url.username || url.password) throw new InputError('Video/audio references require a public HTTPS URL. Paste a link in the reference URL field; the OpenRouter video API does not accept inline video/audio uploads.');
      }
    }
    if (model.kind === 'video' && payload.frame_images !== undefined) {
      if (!Array.isArray(payload.frame_images) || payload.frame_images.some((f: Obj) => !object(f) || !model.raw.supported_frame_images?.includes(f.frame_type))) throw new InputError('Unsupported frame type for this model');
    }
    if (['text', 'audio'].includes(model.kind) && payload.messages !== undefined && !Array.isArray(payload.messages)) throw new InputError('messages must be an array');
    // Validate advanced overrides of advertised scalar fields too.
    validateParameters(model, Object.fromEntries(Object.keys(model.fields).filter(k => k in payload && k !== 'reasoning_effort').map(k => [k, payload[k]])));
    return { model, params, payload, prompt: body.prompt };
  }
  start(prepared: Awaited<ReturnType<OpenRouter['prepare']>>) {
    if (!this.key()) throw new InputError('Set an OpenRouter key in Settings');
    const { model, params, payload, prompt } = prepared;
    const run: CloudRun = { id: randomUUID(), model: model.id, kind: model.kind, prompt, parameters: params, status: 'starting', created: new Date().toISOString(), outputs: [] };
    mkdirSync(join(this.dir, 'runs', run.id), { mode: 0o700 });
    this.save(run);
    this.track(run, () => this.execute(run, payload, this.key()));
    return run;
  }
  private track(run: CloudRun, task: () => Promise<void>) {
    const p = task().catch(e => { run.status = 'failed'; run.error = this.redact((e as Error).message); }).finally(() => {
      if (terminal(run)) run.finished = new Date().toISOString();
      this.save(run); this.pending.delete(run.id);
    });
    this.pending.set(run.id, p);
  }
  async settled(id: string) { await this.pending.get(id); return this.get(id); }
  private async execute(run: CloudRun, payload: Obj, key: string) {
    const res = await this.api(PATHS[run.kind], key, payload, 15 * 60 * 1000);
    run.status = 'running';
    this.save(run);
    if (run.kind === 'speech') {
      const mime = res.headers.get('content-type') || `audio/${payload.response_format || 'mpeg'}`;
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!bytes.length) throw new Error('OpenRouter returned no audio');
      this.output(run, bytes, mime);
    } else if (run.kind === 'audio') {
      await this.readAudio(run, res, payload.audio.format);
    } else {
      const data = await res.json() as Obj;
      if (data.error) throw new Error(data.error.message || String(data.error));
      run.usage = data.usage;
      if (run.kind === 'video') {
        if (typeof data.id !== 'string' || !/^[\w-]+$/.test(data.id)) throw new Error('Invalid video job ID');
        run.job = data.id;
        this.save(run); // persist before polling; never resubmit a paid job after restart
        await this.pollVideo(run, key);
        return;
      }
      if (run.kind === 'image') {
        for (const img of data.data ?? []) {
          if (img.b64_json) this.output(run, Buffer.from(img.b64_json, 'base64'), img.media_type || 'image/png');
        }
        if (!run.outputs.length) throw new Error('OpenRouter returned no images');
      } else {
        const message = data.choices?.[0]?.message;
        run.text = typeof message?.content === 'string' ? message.content : data.text ?? JSON.stringify(data, null, 2);
      }
    }
    run.status = 'succeeded';
  }
  private async readAudio(run: CloudRun, res: Response, format: string) {
    if (!res.body) throw new Error('Missing audio stream');
    const decoder = new TextDecoder(); let buffer = '', text = ''; const chunks: Buffer[] = [];
    const consume = (line: string) => {
      if (!line.startsWith('data:')) return;
      const value = line.slice(5).trim(); if (!value || value === '[DONE]') return;
      const d = JSON.parse(value);
      if (d.error) throw new Error(d.error.message || 'Audio generation failed');
      const delta = d.choices?.[0]?.delta;
      if (delta?.audio?.data) chunks.push(Buffer.from(delta.audio.data, 'base64'));
      text += delta?.audio?.transcript || delta?.content || '';
      if (d.usage) run.usage = d.usage;
    };
    for await (const part of res.body) {
      buffer += decoder.decode(part, { stream: true });
      let n; while ((n = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, n).replace(/\r$/, '')); buffer = buffer.slice(n + 1); }
    }
    buffer += decoder.decode(); if (buffer.trim()) consume(buffer);
    if (!chunks.length) throw new Error('OpenRouter returned no audio');
    this.output(run, Buffer.concat(chunks), format === 'mp3' ? 'audio/mpeg' : `audio/${format}`);
    run.text = text;
  }
  private async pollVideo(run: CloudRun, key: string) {
    const deadline = Date.now() + 24 * 60 * 60 * 1000;
    while (Date.now() < deadline) {
      let data: Obj;
      try { data = await (await this.api(`/api/v1/videos/${run.job}`, key)).json(); }
      catch (e) { if (!/429|50[234]|fetch failed|timeout/i.test((e as Error).message)) throw e; await new Promise(r => setTimeout(r, 10000)); continue; }
      if (['failed', 'canceled', 'cancelled'].includes(data.status)) throw new Error(String(data.error?.message || data.error || data.status));
      if (data.status === 'completed') {
        run.usage = data.usage;
        // Fetch the authenticated content endpoint, never attach credentials to unsigned_urls.
        let res = await this.api(`/api/v1/videos/${run.job}/content`, key);
        for (let redirects = 0; res.status >= 300 && res.status < 400 && redirects < 5; redirects++) {
          const url = new URL(res.headers.get('location') || '', API);
          await assertPublicMediaUrl(url);
          res = await this.fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(10 * 60 * 1000) });
        }
        if (!res.ok) throw new Error(`Video download HTTP ${res.status}`);
        this.output(run, new Uint8Array(await res.arrayBuffer()), res.headers.get('content-type') || 'video/mp4');
        run.status = 'succeeded'; return;
      }
      run.status = data.status === 'pending' ? 'queued' : 'running'; this.save(run);
      await new Promise(r => setTimeout(r, 5000));
    }
    throw new Error('Video still pending after 24 hours; inspect the saved job ID in OpenRouter Activity');
  }
  resume() {
    for (const run of this.list().filter(r => !terminal(r))) {
      if (run.kind === 'video' && run.job) this.track(run, () => this.pollVideo(run, this.key()));
      else { run.status = 'interrupted'; run.error = 'Server restarted before result was saved. Check OpenRouter Activity before retrying; the request may have been billed.'; run.finished = new Date().toISOString(); this.save(run); }
    }
  }
}

// Signed media redirects are untrusted. Reject local destinations and never forward API credentials.
export async function assertPublicMediaUrl(url: URL) {
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new Error('Unsafe media URL');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some(({ address: a }) => {
    if (isIP(a) === 6) return !/^2[0-9a-f]{3}:/i.test(a) || /^2001:(db8|0):/i.test(a);
    const [x, y] = a.split('.').map(Number);
    return x === 0 || x === 10 || x === 127 || x >= 224 || (x === 169 && y === 254) || (x === 172 && y >= 16 && y <= 31) || (x === 192 && (y === 168 || y === 0)) || (x === 100 && y >= 64 && y <= 127) || (x === 198 && [18, 19].includes(y));
  })) throw new Error('Private media destination blocked');
}
