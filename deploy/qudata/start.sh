#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/conda/bin:$PATH"
case "${1:-run}" in
  run)
    # No installation or model download at startup. Forward SIGTERM through
    # the Python supervisor so the three backend processes stop together.
    exec /opt/conda/bin/python /opt/freefield-qudata/serve.py
    ;;
  start)
    # Qudata replaces ENTRYPOINT in SSH/UI mode. Its on-start Command uses
    # this idempotent daemon mode and returns, leaving platform SSH intact.
    /opt/conda/bin/python /opt/freefield-qudata/serve.py --check
    /usr/bin/ssh-keygen -A
    mkdir -p /data/freefield/logs
    nohup /usr/bin/flock -n -E 0 /run/freefield-qudata.lock \
      /opt/conda/bin/python /opt/freefield-qudata/serve.py \
      >> /data/freefield/logs/backend.log 2>&1 < /dev/null &
    exec /opt/conda/bin/python /opt/freefield-qudata/wait_ready.py
    ;;
  *) printf '%s\n' 'Usage: bash /opt/freefield-qudata/start.sh {run|start}' >&2; exit 2 ;;
esac
