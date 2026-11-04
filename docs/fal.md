# fal.ai · Kling Motion Control

Available at `#/fal`, with a separate API key in `#/settings`. This integration
supports four curated endpoints: Kling 3.0 and 2.6, Standard and Pro Motion
Control. It does not expose the entire fal model catalog. Pricing links open the
current model page; billing uses the fal account, independently of OpenRouter.

Choose a character image and a motion reference video from the computer, or
provide direct public HTTPS URLs. Local files are sent as documented base64 data
URIs to the queue API; no separate hosting account is required. Each file is
limited to 25 MiB and the UI limits their combined size to 29 MiB (40 MiB server
JSON limit). Prefer a short full-body motion clip. Orientation `video` allows up
to 30 seconds; `image` up to 10 seconds. Animal-to-human transfer quality and
provider moderation acceptance are not guaranteed.

The server uses the REST queue API with `Authorization: Key …`. Queue status and
result URLs are pinned to the exact fal app/request path before authenticated
requests. Downloading the completed video never forwards the API key to its CDN.
The video is saved locally and can be downloaded from history.

The key is stored in `out/fal/settings.json` (0600), or supplied via `FAL_KEY`.
Only configured/source/defaults are returned to the UI. Saving a key does not
claim that authentication works: access is checked upon the first real request.
Requests and results live in `out/fal/runs/<uuid>/`; metadata omits input file data
and source URLs. Provider-side retention is governed by fal.

The request ID is persisted before polling. Restarting follows existing requests
and never automatically repeats a paid submission. A run without a saved request
ID becomes interrupted: check fal Activity before manually retrying. A pending
run without credentials waits until the key is saved again. Result retrieval
requires the provider to retain the remote job; local outputs survive separately.

Verified 2026-11-04: unit tests use a fake transport (submission, output download,
credential isolation, URL validation, errors, restart recovery). Local browser
checks cover routing and persistent options. No real paid fal inference or
photo/video moderation acceptance was verified.

Sources: [queue](https://fal.ai/docs/documentation/model-apis/inference/queue),
[model API](https://fal.ai/models/fal-ai/kling-video/v3/standard/motion-control/api).
