# Backend only. No model weights, credentials or home-server configuration.
FROM pytorch/pytorch:2.9.1-cuda12.8-cudnn9-runtime@sha256:7b324d212a4450795b49edba9949b7cdc72429148a64e974334bfe5774d51385

ARG FREEFIELD_REVISION=unknown
LABEL org.opencontainers.image.source="https://github.com/AlexMihaa/freefield" \
      org.opencontainers.image.title="FreeField GPU backend for Qudata" \
      org.opencontainers.image.revision="${FREEFIELD_REVISION}"
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_CONSTRAINT=/opt/freefield-qudata/constraints.txt \
    HF_HOME=/data/freefield/cache/huggingface \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility
# Runtime compilation tools are included for PyTorch/Triton GPU paths.
# Native optional kernels and actual GPU performance need a real-device test.
RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates ffmpeg libgl1 libglib2.0-0 openssh-server tini util-linux procps build-essential \
    && apt-get clean \
    && /opt/conda/bin/python -c "from pathlib import Path; root=Path('/etc/ssh'); assert root.resolve()==root; paths=list(root.glob('ssh_host_*')); assert all(p.resolve().parent==root and p.is_file() for p in paths); [p.unlink() for p in paths]"
# Remove apt-generated private SSH host keys in the SAME layer that creates
# them. Qudata must generate unique host keys at instance startup, not reuse
# credentials embedded in a public image.
COPY deploy/qudata/constraints.txt /opt/freefield-qudata/constraints.txt
COPY infra /opt/freefield/infra
COPY tools /opt/freefield/tools
COPY packs /opt/freefield/packs
COPY apps /opt/freefield/apps
COPY LICENSE /opt/freefield/LICENSE
RUN git init /opt/comfyui \
    && git -C /opt/comfyui remote add origin https://github.com/Comfy-Org/ComfyUI.git \
    && git -C /opt/comfyui fetch --depth 1 origin e3bee7ffcb7d6547ed0bcd15221792f3b8646b17 \
    && git -C /opt/comfyui checkout --detach FETCH_HEAD \
    && /opt/conda/bin/python /opt/freefield/tools/local_backend.py setup /opt/comfyui --models /data/freefield/models \
    && /opt/conda/bin/python -m pip check \
    && /opt/conda/bin/python -m pip freeze > /opt/freefield-qudata/installed-python.txt \
    && mkdir -p /data/freefield/models /data/freefield/logs /run/sshd \
    && printf 'PasswordAuthentication no\nPermitRootLogin prohibit-password\n' > /etc/ssh/sshd_config.d/freefield.conf
COPY deploy/qudata/start.sh deploy/qudata/serve.py deploy/qudata/wait_ready.py /opt/freefield-qudata/
WORKDIR /opt/freefield
EXPOSE 8000/tcp
HEALTHCHECK --interval=30s --timeout=5s --start-period=300s --retries=3 \
    CMD /opt/conda/bin/python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)" || exit 1
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/bin/bash", "/opt/freefield-qudata/start.sh", "run"]
