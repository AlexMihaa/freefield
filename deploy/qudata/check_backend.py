"""Check gateway readiness/authentication without model weights (CI/local)."""
import json
import os
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

base = os.environ.get("COMFY_BASE_URL", "http://127.0.0.1:18000").rstrip("/")
token = os.environ["FREEFIELD_TOKEN"]
for attempt in range(180):
    try:
        with urlopen(base + "/health", timeout=2) as response:
            assert json.load(response)["ok"] is True
        break
    except (URLError, TimeoutError, ConnectionError):
        time.sleep(2)
else:
    raise SystemExit("Gateway did not become healthy within six minutes")

for headers in [{}, {"Authorization": "Bearer invalid-token"}]:
    try:
        urlopen(Request(base + "/freefield/status", headers=headers), timeout=5)
        raise AssertionError("Gateway allowed an unauthenticated request")
    except HTTPError as error:
        assert error.code == 401

headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json"}
with urlopen(Request(base + "/freefield/status", headers=headers), timeout=10) as response:
    status = json.load(response)
    assert "error" not in status["comfyui"], status
with urlopen(Request(base + "/freefield/prepare", data=b'{"app":"smoke","models":"none"}', headers=headers), timeout=10) as response:
    assert json.load(response)["current"] == "smoke"
print("Gateway health/auth/status/prepare passed; no models requested")
