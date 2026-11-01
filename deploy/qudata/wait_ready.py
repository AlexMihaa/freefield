"""Wait for the authenticated backend, without disclosing its token."""
import json
import os
import time
from urllib.error import URLError
from urllib.request import Request, urlopen

for attempt in range(180):
    try:
        request = Request("http://127.0.0.1:8000/freefield/status", headers={"Authorization": "Bearer " + os.environ["FREEFIELD_TOKEN"]})
        with urlopen(request, timeout=3) as response:
            status = json.load(response)
        if isinstance(status.get("comfyui"), dict) and "error" not in status["comfyui"]:
            print("FreeField backend ready on internal port 8000 (token protected)")
            break
    except (URLError, TimeoutError, ConnectionError, ValueError):
        pass
    time.sleep(2)
else:
    raise SystemExit("Backend did not become ready. Inspect /data/freefield/logs/backend.log; no models are downloaded automatically.")
