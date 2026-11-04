# OpenRouter cloud studio

## Implementation and verification — 2026-11-04

Implemented in the fork and deployed to the home UI. No GPU backend changes
are required. Agent verification does not submit paid generations. Existing ComfyUI apps and history keep
their current execution path. Cloud requests never wake or contact the GPU.

Open **OpenRouter** in the navigation (`#/cloud`) and **Settings** (`#/settings`).
Settings accepts an OpenRouter API key, tests it with the key-information API,
and removes the saved key. It never returns the key to the browser. The field
is cleared after saving. There is no browser/localStorage credential copy.

## Operations and discovery

The live catalog combines `/api/v1/models?output_modalities=all`,
`/api/v1/images/models` and `/api/v1/videos/models`, cached for five minutes.
“Refresh models” bypasses the cache. Failure of an individual catalog is shown
as a warning; missing capabilities are not silently invented.

- Images: dedicated Image API, image references, model-advertised enum/range
  controls, multiple images, PNG/JPEG/WebP/SVG downloads.
- Video: asynchronous jobs, HTTPS video/audio references, supported durations/resolutions/aspect ratios,
  first/last frames, references and source clips, audio toggle, seed, upscale
  factor/creativity when advertised. Input types come from the general catalog.
- Speech and sounds: TTS binary audio, live voice list, delivery instructions,
  optional format/speed; reference recordings/scene image for compatible providers.
- Audio response: Chat Completions SSE audio and transcript assembly.
- Text: Chat Completions, model-supported sampling/token/reasoning controls,
  image/audio/video/PDF inputs when the model advertises them.
- Speech recognition: JSON audio input, transcript and optional verbose output.
- Embeddings and rerank: native endpoints, vector/result JSON in history.
- Decisions and extractions: native alpha endpoints, typed question/field JSON
  schema, text state; native advanced options accept richer state/assets.

Forms regenerate on model changes. Numeric/enumerated parameters are checked
again on the server, including numeric `seed` (a boolean discovery capability
means support, not a boolean seed value), `false` audio toggles and zero values.
Conflicting size vs resolution/aspect-ratio settings are rejected before submission.
Defaults save the chosen model and ordinary form parameters per operation.

“Advanced model features” accepts native JSON options (voice cloning,
multi-speaker input, structured responses, tools, provider routing/passthrough,
custom state/assets, remote media URLs, etc.). It cannot replace model, streaming
protocol, output modalities or add a callback URL. Known scalar overrides are
validated. Provider endpoint details and prices can be inspected from this panel.
Advanced JSON, attachments, alpha schemas and prompt text are **not** stored as defaults.

## Storage and access

`FREEFIELD_OUT/openrouter/` (default `out/openrouter/`) contains:

- `settings.json`: saved key and defaults, atomic writes, mode 0600.
- `runs/<uuid>/meta.json`: model, ordinary parameters, prompt, status, usage,
  outputs and remote video job ID. The credential and native request body are
  not copied into history.
- `runs/<uuid>/output-*`: retained media with byte-range serving.

`OPENROUTER_API_KEY` is an optional fallback. Removing the saved key does not
remove a separately configured environment key. Use a persistent writable
`FREEFIELD_OUT` volume with a read-only container root filesystem. The existing
home history volume already covers this path; no deployment config was changed.
Backups of this volume now contain the key and must be treated as private.

Settings/key and cloud history are shared by users of this Freefield instance.
Existing `FREEFIELD_PASSCODE` gating covers these routes too. OpenRouter is disabled
on the hosted-demo mode. JSON writes reject cross-origin requests and require
`application/json`. Keep the instance within its existing trusted access boundary.
API credentials are only sent to the fixed OpenRouter API origin. Video content
is fetched from its authenticated content endpoint; external redirects receive
no authorization and local/private destinations are rejected. SVG is served as
an attachment in a sandbox rather than active same-origin markup.

## Job lifecycle and limits

A run is saved before submission. Video job IDs are persisted before polling;
a server restart resumes polling, never resubmits the paid request. Synchronous
requests interrupted before their result was saved become `interrupted`, with
an instruction to check OpenRouter Activity before retrying. This avoids automatic
double billing. Uncertain submission failures likewise need an Activity check.

Video polling tolerates transient network/429/502/503/504 errors and waits up to
24 hours after each start/resume. Cloud submission errors keep the returned
provider message with credentials redacted. Existing run limits count cloud jobs.
No cloud cancel/delete action is offered; closing the browser does not stop work
or billing. Cloud history is separate from the ComfyUI Library, in the cloud studio.

Uploads: 25 MiB per file, 29 MiB total in the UI, at most 40 MiB JSON per request
(or the lower configured upload limit). Image and chat inputs use inline base64.
The video-generation API rejects inline video/audio: use the dedicated HTTPS URL
fields (one URL per line), including temporary signed URLs from your own storage.
Video-mode file pickers accept images only. Server-side validation also rejects
inline video/audio supplied via advanced JSON before creating a run. OpenRouter
Files API does not accept video or expose uploaded files as downloadable HTTPS
assets, so it cannot bridge this restriction. No third-party media host or public
upload endpoint is enabled automatically. Do not use home LAN URLs for cloud provider input.
PCM output is downloadable but not played as containerized audio in the browser.
Only the first video output is downloaded when a provider returns several clips.

TTS formats/speed and transcription verbose output are common API controls:
the public catalog does not publish exhaustive per-model constraints for them,
so the UI explicitly labels provider-dependent options. Empty fields retain
provider defaults. Native extras are sent as supplied; OpenRouter/provider still
validates their schema and combinations. Tool execution, a conversational agent
loop, streaming text UI, provider account/billing management and alpha schema
builders are outside this studio; native requests/results are supported.

## Verification

`npm test`, `npm run typecheck`, `npm run validate`, `git diff --check`.
Tests use injected HTTP responses: catalog capabilities, private credential
persistence, parameter validation, image output, binary TTS, transcription,
text/reasoning, split SSE/UTF-8 audio, embeddings/rerank, alpha operations,
video downloads, resume without resubmission, redaction and redirect credentials.
62/62 tests passed, typecheck passed, and all 120 existing manifests validated
with zero errors/warnings. The live public catalog and real localhost UI were
checked without an API key at desktop 1440x1000 and mobile 390x844. HTTP smoke
covered a fake-key save/remove round trip, no key disclosure, origin/content-type
checks, and invalid-parameter rejection without creating a cloud or GPU run.
Paid generation/provider billing has **not** been verified.

## API references (checked 2026-11-04)

- [Images](https://openrouter.ai/docs/guides/overview/multimodal/image-generation)
- [Video](https://openrouter.ai/docs/guides/overview/multimodal/video-generation)
- [Speech](https://openrouter.ai/docs/guides/overview/multimodal/tts)
- [Transcription](https://openrouter.ai/docs/guides/overview/multimodal/stt)
- [Audio SSE](https://openrouter.ai/docs/guides/overview/multimodal/audio)
- [Model discovery](https://openrouter.ai/docs/api/api-reference/models/get-models)
- [Decisions](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request)

Key checks reject management/provisioning keys even if GET /api/v1/key returns
200, since those keys cannot be used for generation. A regular inference key is
required. Tests cover this distinction and HTTPS reference validation.
