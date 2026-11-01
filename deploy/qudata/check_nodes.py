"""Run inside the started container: all ready workflows' node classes exist."""
import json
from pathlib import Path
from urllib.request import urlopen

with urlopen("http://127.0.0.1:8188/object_info", timeout=30) as response:
    nodes = json.load(response)
missing = {}
for path in Path("/opt/freefield/apps").glob("*/app.json"):
    app = json.loads(path.read_text())
    if app["status"] != "ready" or not app.get("workflow"):
        continue
    workflow = json.loads((path.parent / app["workflow"]).read_text())
    absent = sorted({node["class_type"] for node in workflow.values()} - nodes.keys())
    if absent:
        missing[app["id"]] = absent
assert not missing, json.dumps(missing, indent=2)
for root in [Path("/data/freefield/models"), Path("/opt/comfyui/models")]:
    assert not [path for path in root.rglob("*") if path.suffix.lower() in {".safetensors", ".ckpt", ".pt", ".pth", ".gguf"}], f"Unexpected model weights in {root}"
print(f"{len(nodes)} node classes loaded, every ready workflow covered, model directories contain no weights")
