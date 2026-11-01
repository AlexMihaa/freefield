# NVIDIA GPU backend on Qudata

This packaging is independent of the Russian-localization branch/PR. It builds a
backend-only `linux/amd64` image from a digest-pinned PyTorch 2.9.1/CUDA 12.8
runtime, the same ComfyUI/custom-node commits as FreeField's manifests, and
comfy-api-proxy 0.1.6. No model weights or credentials are included. Host compiler,
ffmpeg and OpenSSH are installed; apt-generated SSH host keys are removed in the
same layer, and fresh keys are generated during the SSH-mode initialization.

## Build and verification

`.github/workflows/qudata-gpu.yml` builds on GitHub-hosted CPU runners. Before
publishing to `ghcr.io/alexmihaa/freefield-gpu`, it runs startup-policy tests,
authentication/readiness checks, verifies all ready workflows' node classes,
and runs the model-free `smoke` workflow end to end. It also simulates Qudata's
ENTRYPOINT override and repeated initialization. Publication is gated on these
checks. This is **not** real NVIDIA inference, a performance benchmark or a real
Qudata lifecycle test.

The published tag is `qudata-<12-character build commit>-cu128`. Use the exact
successful tag/digest, not `latest` or Qudata's `[Automatic]`. Source/base and the
PyTorch trio are pinned; other Python dependencies resolve at build time and are
recorded in `/opt/freefield-qudata/installed-python.txt`. Rebuilds are not claimed
to be bit-identical.

A newly created GitHub container package can be private despite a public source
repository. Change its visibility to Public in GitHub Packages, then verify an
anonymous manifest request before renting a GPU. Do not put registry passwords
into a public image.

## Qudata template fields

Official semantics: <https://qudata.ai/docs/service/templates>.

| Field | Value |
| --- | --- |
| Name | FreeField GPU — NVIDIA CUDA 12.8 (no models) |
| Docker Image | `ghcr.io/alexmihaa/freefield-gpu` |
| Version Tag | Exact successful `qudata-<build commit>-cu128` tag |
| SSH | Enabled; attach your public SSH key to the instance |
| Ports | Only SSH22/TCP (do not duplicate it if SSH adds it automatically) |
| Web UI | Disabled; the web app is hosted separately |
| Command / initialization | `bash /opt/freefield-qudata/start.sh start` |
| Environment | `FREEFIELD_TOKEN` = private random 64-hex token; optional `FREEFIELD_COMFY_ARGS=--reserve-vram 1` |
| Docker Auth | Empty after public anonymous access is verified |
| Min Disk | Suggested200GB for the image, one video pack and outputs, not all models |
| Recommended GPU | A40/L40S48GB; verify the actual offer, driver and VRAM |

Do **not** forward ComfyUI8188 or API-proxy8189. The token-protected gateway is
internal port8000; reach it using an SSH tunnel, not public cleartext HTTP.
The Qudata WebUI token, Qudata management API key and FREEFIELD_TOKEN are separate
credentials. Generate FREEFIELD_TOKEN locally, e.g. `openssl rand -hex 32`.

Qudata replaces the image ENTRYPOINT when SSH/UI is enabled. The Command above
is therefore mandatory. It checks the token and CUDA, launches one backend under
`flock`, waits for authenticated readiness and writes logs to
`/data/freefield/logs/backend.log`. The normal Docker ENTRYPOINT runs the backend
in the foreground. No packages or models are installed at container startup.

## Models, storage and cost

The image defaults to HF/Transformers offline mode. Video generation still
requires explicitly installing the relevant models and accepting any gated
licenses. A model-free plan is safe to inspect before authorizing downloads:

```sh
/opt/conda/bin/python /opt/freefield/tools/local_backend.py download /opt/comfyui --models /data/freefield/models video-ltx25 --dry-run
```

Models go to `/data/freefield/models`; ordinary ComfyUI input/output directories
are `/opt/comfyui/input` and `/opt/comfyui/output`. These are image paths, **not** a
verified Qudata persistent-volume contract. Do not assume recreation, deletion or
migration preserves them. A model pack is not the whole catalog; installing all
packs may need hundreds of gigabytes.

Charges start at Rent, including deployment. Idle/warm indicators in FreeField
are not Qudata billing controls. Qudata documents deletion as erasing all data and
stopping charges; prepaid-month instances cannot be deleted early. Back up first
and require explicit confirmation before deleting an instance. No pause-billing
or storage-only mode is assumed. Sources:
<https://qudata.ai/docs/faq/instances>,
<https://qudata.ai/docs/service/instances>,
<https://qudata.ai/docs/faq/billing>.

The real platform's init-script ordering, UID, timeout/reaping, forwarded SSH
address and disk lifecycle remain canary-test requirements. Do not claim real
Qudata/GPU readiness from CPU CI or an open `/health` endpoint alone.
