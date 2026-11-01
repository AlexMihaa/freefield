"""Launch upstream's pinned backend; never install dependencies or models here."""
from __future__ import annotations

import os
import math
import shlex
import signal
import sys
from pathlib import Path


def configuration(environ: dict[str, str]) -> list[str]:
    token = environ.get("FREEFIELD_TOKEN", "")
    if len(token) < 32 or not token.isascii() or any(c.isspace() for c in token) or token.lower().startswith(("change", "replace", "example", "<")):
        raise ValueError("Set FREEFIELD_TOKEN to a private random token of at least 32 characters; do not use a sample value")
    if environ.get("FREEFIELD_ALLOW_OPEN") == "1":
        raise ValueError("FREEFIELD_ALLOW_OPEN=1 is forbidden in the Qudata image")
    device = environ.get("FREEFIELD_DEVICE", "cuda")
    if device not in {"cuda", "cpu"}:
        raise ValueError("FREEFIELD_DEVICE must be cuda (normal) or cpu (model-free CI only)")
    args = shlex.split(environ.get("FREEFIELD_COMFY_ARGS", ""))
    # Exact allowlist: upstream argparse accepts abbreviated options, so a
    # denylist alone would let --lis override --listen and expose ComfyUI.
    flags = {"--lowvram", "--normalvram", "--highvram", "--disable-smart-memory", "--use-pytorch-cross-attention", "--force-fp32", "--force-fp16"}
    index = 0
    while index < len(args):
        argument = args[index]
        if argument in flags:
            index += 1
            continue
        if argument == "--reserve-vram" and index + 1 < len(args):
            try:
                reserve = float(args[index + 1])
            except ValueError:
                reserve = -1
            if math.isfinite(reserve) and reserve >= 0:
                index += 2
                continue
        raise ValueError("Unsupported FREEFIELD_COMFY_ARGS: use exact supported VRAM/performance flags only")
    return (["--cpu"] if device == "cpu" else []) + args


def main() -> None:
    try:
        args = configuration(dict(os.environ))
    except ValueError as error:
        raise SystemExit(str(error)) from None
    import torch
    if os.environ.get("FREEFIELD_DEVICE", "cuda") == "cuda" and not torch.cuda.is_available():
        raise SystemExit("NVIDIA CUDA GPU not available. Check the Qudata GPU allocation/driver. Refusing silent CPU fallback.")
    if "--check" in sys.argv:
        return
    models = Path("/data/freefield/models")
    models.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, "/opt/freefield")
    from tools.local_backend import serve
    # Upstream handles KeyboardInterrupt in a finally block, terminating all
    # children. The same cleanup must run on Docker/Qudata SIGTERM.
    def stop(_signum, _frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, stop)
    serve(Path("/opt/comfyui"), args, 8000)


if __name__ == "__main__":
    main()
