import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpenRouter, validateParameters, assertPublicMediaUrl } from '../server/openrouter.ts';

const image = { id: 'test/image', name: 'Image', architecture: { input_modalities: ['text', 'image'] }, supported_parameters: { resolution: { type: 'enum', values: ['1K', '2K'] }, n: { type: 'range', min: 1, max: 2 }, seed: { type: 'boolean' }, size: { type: 'boolean' }, input_references: { type: 'range', min: 0, max: 2 } } };
const video = { id: 'test/video', name: 'Video', supported_durations: [4, 8], supported_resolutions: ['720p'], supported_frame_images: ['first_frame'], generate_audio: true, seed: true };
const raws = [
  { id: 'test/text', endpoints: ['/api/v1/chat/completions'], architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] }, supported_parameters: ['temperature', 'max_tokens', 'reasoning'], reasoning: { supported_efforts: ['low', 'high'] } },
  { id: 'test/audio', endpoints: ['/api/v1/chat/completions'], architecture: { output_modalities: ['audio'] }, supported_voices: ['coral'] },
  { id: 'test/speech', endpoints: ['/api/v1/audio/speech'], supported_voices: ['voice-a'] },
  { id: 'test/transcription', endpoints: ['/api/v1/audio/transcriptions'] },
  { id: 'test/embeddings', endpoints: ['/api/v1/embeddings'] },
  { id: 'test/rerank', endpoints: ['/api/v1/rerank'] },
  { id: 'test/decisions', endpoints: ['/api/alpha/decisions'] },
  { id: 'test/extractions', endpoints: ['/api/alpha/extractions'] },
];
const json = (data: unknown) => Response.json(data);
function fixture(t: any, handle: (path: string, init?: RequestInit) => Response | Promise<Response> = () => json({})) {
  const dir = mkdtempSync(join(tmpdir(), 'freefield-openrouter-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const calls: { path: string; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const path = String(input).replace('https://openrouter.ai', '');
    calls.push({ path, init });
    if (path === '/api/v1/models?output_modalities=all') return json({ data: raws });
    if (path === '/api/v1/images/models') return json({ data: [image] });
    if (path === '/api/v1/videos/models') return json({ data: [video] });
    return handle(path, init);
  };
  const service = new OpenRouter(dir, fetcher);
  service.saveSettings({ key: 'sk-or-test-fake-key' });
  return { service, dir, calls, fetcher };
}

test('catalog discovers separate media and standard operations; coalesces concurrent loads', async t => {
  const { service, calls } = fixture(t);
  const catalogs = await Promise.all([service.catalog(), service.catalog()]);
  assert.equal(calls.length, 3);
  assert.deepEqual(catalogs[0].models.map(m => m.kind).sort(), ['audio', 'decisions', 'embeddings', 'extractions', 'image', 'rerank', 'speech', 'text', 'transcription', 'video']);
  assert.deepEqual((await service.model('test/speech', 'speech')).fields.voice.values, ['voice-a']);
});

test('capability descriptors validate exact model values and keep false and zero', async t => {
  const { service } = fixture(t);
  const m = await service.model('test/image', 'image');
  assert.equal(m.fields.seed.type, 'integer');
  assert.equal(m.fields.size.type, 'string');
  assert.deepEqual(validateParameters(m, { seed: 0, n: 2, resolution: '2K' }), { seed: 0, n: 2, resolution: '2K' });
  for (const bad of [{ n: 1.2 }, { n: 3 }, { resolution: '8K' }, { size: '1024x1024', resolution: '1K' }, { token: 'oops' }]) assert.throws(() => validateParameters(m, bad));
  const v = await service.model('test/video', 'video');
  assert.deepEqual(validateParameters(v, { generate_audio: false, seed: 0, duration: 8 }), { generate_audio: false, seed: 0, duration: 8 });
  assert.throws(() => validateParameters(v, { duration: 6 }));
});

test('settings never disclose key; atomic private file survives restart', t => {
  const { service, dir, fetcher } = fixture(t);
  assert.equal(JSON.stringify(service.status()).includes('sk-or-'), false);
  assert.equal(statSync(join(dir, 'settings.json')).mode & 0o777, 0o600);
  assert.equal(new OpenRouter(dir, fetcher).status().configured, true);
  assert.throws(() => service.saveSettings({ key: 'not-a-key' }));
  assert.equal(service.status().configured, true);
  service.saveSettings({ key: '' });
  assert.equal(readFileSync(join(dir, 'settings.json'), 'utf8').includes('sk-or-'), false);
});

test('image request preserves native provider options and saves base64 outputs', async t => {
  const { service, calls } = fixture(t, () => json({ data: [{ b64_json: Buffer.from('PNG').toString('base64'), media_type: 'image/png' }], usage: { cost: 0.02 } }));
  const p = await service.prepare({ kind: 'image', model: image.id, prompt: 'photo', parameters: { n: 2 }, advanced: { provider: { options: { test: { detail: true } } } } });
  const r = service.start(p);
  const done = await service.settled(r.id);
  assert.equal(done?.status, 'succeeded');
  assert.equal(readFileSync(service.file(r.id, done!.outputs[0].file)!, 'utf8'), 'PNG');
  assert.equal(service.file(r.id, '../settings.json'), null);
  assert.equal(JSON.parse(String(calls.at(-1)?.init?.body)).provider.options.test.detail, true);
  assert.equal(JSON.stringify(done).includes('sk-or-'), false);
});

test('speech streams bytes, transcription and text preserve results', async t => {
  const { service } = fixture(t, (path, init) => {
    const b = JSON.parse(String(init?.body));
    if (path.endsWith('/speech')) { assert.equal(b.voice, 'voice-a'); return new Response('WAVE', { headers: { 'content-type': 'audio/wav' } }); }
    if (path.endsWith('/transcriptions')) { assert.equal(b.input_audio.format, 'wav'); return json({ text: 'hello' }); }
    assert.deepEqual(b.reasoning, { effort: 'high' }); assert.equal(b.reasoning_effort, undefined);
    return json({ choices: [{ message: { content: 'answer' } }], usage: { cost: 0.001 } });
  });
  for (const [kind, parameters, advanced] of [['speech', { voice: 'voice-a' }, {}], ['transcription', {}, { input_audio: { data: 'AAAA', format: 'wav' } }], ['text', { reasoning_effort: 'high' }, {}]] as const) {
    const p = await service.prepare({ kind, model: `test/${kind}`, prompt: 'hello', parameters, advanced });
    const r = await service.settled(service.start(p).id);
    assert.equal(r?.status, 'succeeded');
    if (kind === 'speech') assert.equal(r?.outputs[0].type, 'audio/wav'); else assert.equal(r?.text, kind === 'text' ? 'answer' : 'hello');
  }
});

test('streaming audio handles split UTF-8/SSE chunks and transcripts', async t => {
  const { service } = fixture(t, (_path, init) => {
    const b = JSON.parse(String(init?.body)); assert.equal(b.stream, true); assert.equal(b.audio.voice, 'coral');
    const bytes = new TextEncoder().encode('data: {"choices":[{"delta":{"audio":{"data":"V0FW","transcript":"Привет"}}}]}\r\n\r\ndata: {"choices":[{"delta":{"audio":{"data":"RQ=="}}}]}\n\ndata: [DONE]');
    return new Response(new ReadableStream({ start(c) { for (const x of bytes) c.enqueue(Uint8Array.of(x)); c.close(); } }));
  });
  const r = await service.settled(service.start(await service.prepare({ kind: 'audio', model: 'test/audio', prompt: 'speak', parameters: { voice: 'coral', format: 'wav' } })).id);
  assert.equal(r?.status, 'succeeded'); assert.equal(r?.text, 'Привет'); assert.equal(readFileSync(service.file(r!.id, r!.outputs[0].file)!, 'utf8'), 'WAVE');
});

test('video persists job ID and downloads from authenticated API without unsigned URL dependence', async t => {
  const { service, calls } = fixture(t, (path, init) => {
    if (path === '/api/v1/videos') { const b = JSON.parse(String(init?.body)); assert.equal(b.generate_audio, false); return json({ id: 'job-1', status: 'pending' }); }
    if (path.endsWith('/content')) return new Response('VIDEO', { headers: { 'content-type': 'video/mp4' } });
    return json({ status: 'completed', usage: { cost: 1 } });
  });
  const r = await service.settled(service.start(await service.prepare({ kind: 'video', model: video.id, prompt: 'clip', parameters: { generate_audio: false, duration: 4 } })).id);
  assert.equal(r?.status, 'succeeded'); assert.equal(r?.job, 'job-1');
  assert.equal(calls.find(c => c.path.endsWith('/content'))?.init?.headers && (calls.find(c => c.path.endsWith('/content'))!.init!.headers as any).authorization, 'Bearer sk-or-test-fake-key');
});

test('video restart resumes polling without resubmitting paid request; other interrupted runs are explicit', async t => {
  const { service, dir, calls } = fixture(t, path => path.endsWith('/content') ? new Response('VIDEO', { headers: { 'content-type': 'video/mp4' } }) : json({ status: 'completed' }));
  const id = '00000000-0000-4000-8000-000000000001';
  mkdirSync(join(dir, 'runs', id));
  writeFileSync(join(dir, 'runs', id, 'meta.json'), JSON.stringify({ id, model: video.id, kind: 'video', prompt: 'clip', status: 'running', job: 'job-resume', created: new Date().toISOString(), outputs: [] }));
  const other = '00000000-0000-4000-8000-000000000002';
  mkdirSync(join(dir, 'runs', other));
  writeFileSync(join(dir, 'runs', other, 'meta.json'), JSON.stringify({ id: other, kind: 'image', status: 'starting', created: new Date().toISOString(), outputs: [] }));
  service.resume();
  assert.equal((await service.settled(id))?.status, 'succeeded');
  assert.equal(service.get(other)?.status, 'interrupted');
  assert.equal(calls.some(c => c.init?.method === 'POST'), false);
});

test('redirects to public media never receive key; private destinations blocked', async t => {
  const { service, calls } = fixture(t, path => path.endsWith('/content') ? new Response(null, { status: 302, headers: { location: 'https://8.8.8.8/video.mp4' } }) : path === 'https://8.8.8.8/video.mp4' ? new Response('VIDEO', { headers: { 'content-type': 'video/mp4' } }) : path === '/api/v1/videos' ? json({ id: 'job-2' }) : json({ status: 'completed' }));
  const r = await service.settled(service.start(await service.prepare({ kind: 'video', model: video.id, prompt: 'clip' })).id);
  assert.equal(r?.status, 'succeeded'); assert.equal(calls.at(-1)?.init?.headers, undefined);
  for (const url of ['https://127.0.0.1/x', 'https://[::1]/', 'https://192.168.1.1/', 'https://169.254.169.254/', 'http://8.8.8.8/', 'https://[::ffff:127.0.0.1]/', 'https://user:pass@8.8.8.8/']) await assert.rejects(assertPublicMediaUrl(new URL(url)));
});

test('upstream errors are redacted; invalid native overrides rejected before submission', async t => {
  const { service } = fixture(t, () => json({ error: { message: 'bad sk-or-test-fake-key' } }));
  const r = await service.settled(service.start(await service.prepare({ kind: 'text', model: 'test/text', prompt: 'hello' })).id);
  assert.equal(r?.status, 'failed'); assert.equal(r?.error?.includes('sk-or-'), false);
  await assert.rejects(service.prepare({ kind: 'text', model: 'test/text', prompt: 'hello', advanced: { model: 'other' } }));
  await assert.rejects(service.prepare({ kind: 'image', model: image.id, prompt: 'hello', advanced: { resolution: '8K' } }));
});

test('embeddings and rerank use their native endpoints and save JSON output', async t => {
  const { service } = fixture(t, (path, init) => {
    const b = JSON.parse(String(init?.body));
    if (path.endsWith('/embeddings')) { assert.deepEqual(b.input, ['one', 'two']); return json({ data: [{ embedding: [0, 1] }] }); }
    assert.equal(b.query, 'one'); assert.deepEqual(b.documents, ['two']); return json({ results: [{ index: 0, relevance_score: 0.5 }] });
  });
  for (const kind of ['embeddings', 'rerank']) {
    const r = await service.settled(service.start(await service.prepare({ kind, model: `test/${kind}`, prompt: kind === 'embeddings' ? 'one\ntwo' : 'one', advanced: kind === 'rerank' ? { documents: ['two'] } : {} })).id);
    assert.equal(r?.status, 'succeeded'); assert.ok(r?.text);
  }
});

test('video upscale numeric capability ranges and frame/reference restrictions are checked', async t => {
  const { service } = fixture(t);
  const { modelFields } = await import('../server/openrouter.ts');
  assert.deepEqual(modelFields({ upscale_factor: { min: 1.5, max: 3 }, creativity: [0, 1] }, 'video').upscale_factor, { type: 'range', min: 1.5, max: 3 });
  await assert.rejects(service.prepare({ kind: 'image', model: image.id, prompt: 'photo', advanced: { input_references: [{}, {}, {}] } }));
  await assert.rejects(service.prepare({ kind: 'video', model: video.id, prompt: 'clip', advanced: { frame_images: [{ frame_type: 'last_frame' }] } }));
});


test('alpha decisions and extractions require native schema and preserve typed JSON', async t => {
  const { service } = fixture(t, (path, init) => {
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.state, { text: 'Alice' });
    assert.ok(path === '/api/alpha/decisions' ? body.questions : body.fields);
    return json({ result: { name: 'Alice', probability: 0.9 } });
  });
  for (const kind of ['decisions', 'extractions']) {
    await assert.rejects(service.prepare({ kind, model: `test/${kind}`, prompt: 'Alice' }));
    const advanced = kind === 'decisions' ? { questions: { person: { type: 'noul', instructions: 'Is this a person?' } } } : { fields: { name: { type: 'text', instructions: 'Person name' } } };
    const r = await service.settled(service.start(await service.prepare({ kind, model: `test/${kind}`, prompt: 'Alice', advanced })).id);
    assert.equal(r?.status, 'succeeded'); assert.equal(JSON.parse(r!.text!).result.name, 'Alice');
  }
});

test('video accepts HTTPS video/audio references and inline images, rejects inline video/audio before submission', async t => {
  const { service, calls } = fixture(t);
  const request = (refs: unknown) => ({ kind: 'video', model: video.id, prompt: 'dance', advanced: { input_references: refs } });
  const refs = [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }, { type: 'video_url', video_url: { url: 'https://storage.example/clip.mp4?signature=private' } }, { type: 'audio_url', audio_url: { url: 'https://storage.example/sound.mp3' } }];
  assert.deepEqual((await service.prepare(request(refs))).payload.input_references, refs);
  for (const ref of [{ type: 'video_url', video_url: { url: 'data:video/mp4;base64,AAAA' } }, { type: 'audio_url', audio_url: { url: 'data:audio/mpeg;base64,AAAA' } }, { type: 'video_url', video_url: { url: 'http://storage.example/clip.mp4' } }, { type: 'video_url', video_url: { url: 'https://user:password@storage.example/clip.mp4' } }, { type: 'video_url' }]) await assert.rejects(service.prepare(request([ref])));
  assert.equal(calls.some(c => c.init?.method === 'POST'), false);
  assert.deepEqual(service.list(), []);
});

test('key check rejects management/provisioning keys even when current-key endpoint returns 200', async t => {
  let data: any = { is_management_key: true, is_provisioning_key: true };
  const { service } = fixture(t, () => json({ data }));
  await assert.rejects(service.check(), /Management API keys/);
  data = { is_management_key: false, is_provisioning_key: true };
  await assert.rejects(service.check(), /Management API keys/);
  data = { is_management_key: false, is_provisioning_key: false, limit_remaining: 10 };
  assert.deepEqual(await service.check(), { ok: true, limit_remaining: 10 });
});
