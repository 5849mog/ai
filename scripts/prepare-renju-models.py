"""Reproduce the pinned, separate Renju weight package without rebuilding WASM."""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
COMMIT = "918b757a129258e9e765f77fe17d507c2bb1a60b"
SOURCE = ROOT / ".cache" / "rapfi-networks"
OUTPUT = ROOT / "engine" / "renju-250615"
if not SOURCE.exists():
    SOURCE.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "clone", "--no-checkout", "https://github.com/dhbloo/rapfi-networks.git", str(SOURCE)], check=True)
OUTPUT.mkdir(parents=True, exist_ok=True)
for color in ["black", "white"]:
    name = f"mix9svqrenju_bs15_{color}.bin.lz4"
    data = subprocess.check_output(["git", "show", f"{COMMIT}:mix9svq/{name}"], cwd=SOURCE)
    (OUTPUT / name).write_bytes(data)
    for offset in range(0, len(data), 393216):
        (OUTPUT / f"{color}.{offset // 393216:02d}.part").write_bytes(data[offset:offset + 393216])
config = (ROOT / "engine/rapfi-250615/config.toml").read_text()
config += '\n[[model.evaluator.weights]]\nweight_file_black = "mix9svqrenju_bs15_black.bin.lz4"\nweight_file_white = "mix9svqrenju_bs15_white.bin.lz4"\n'
(OUTPUT / "config.toml").write_text(config)
files = {}
for name in ["config.toml", *sorted(p.name for p in OUTPUT.glob("*.part"))]:
    data = (OUTPUT / name).read_bytes()
    files[name] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
models = []
for color in ["black", "white"]:
    name = f"mix9svqrenju_bs15_{color}.bin.lz4"
    data = (OUTPUT / name).read_bytes()
    models.append({"name": name, "parts": sorted(p.name for p in OUTPUT.glob(f"{color}.*.part")), "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
(OUTPUT / "manifest.json").write_text(json.dumps({"version": 2, "sourceCommit": "1be1551ced57e38d53ed58f6d74bf6f8b4bdc230", "networksCommit": COMMIT, "rule": "renju-15", "models": models, "files": files}, indent=2) + "\n")
print(json.dumps(files, indent=2))
