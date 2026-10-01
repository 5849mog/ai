"""Build the pinned Rapfi browser distribution (Python 3, git, CMake, Ninja, emsdk).

Activate emsdk 3.1.64 first, then run: python scripts/build-engine.py
The third-party checkout and compiler outputs stay under .cache.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache"
SOURCE = CACHE / "rapfi"
OUTPUT = ROOT / "engine" / "rapfi-250615"
RAPFI_COMMIT = "1be1551ced57e38d53ed58f6d74bf6f8b4bdc230"
NETWORK_COMMIT = "918b757a129258e9e765f77fe17d507c2bb1a60b"
SDK_VERSION = "3.1.64"


def run(*args, cwd=ROOT):
    subprocess.run([str(a) for a in args], cwd=cwd, check=True)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def dependency_notices(emsdk):
    """Preserve upstream notices for the linked libraries and WASM runtime."""
    sections = []
    for relative in ["cpptoml/LICENSE", "cxxopts/LICENSE", "lz4/LICENSE"]:
        path = SOURCE / "Rapfi" / "external" / relative
        sections.append(("Rapfi/external/" + relative, path.read_text(encoding="utf-8")))
    headers = [SOURCE / "Rapfi/external/lz4/include/lz4Stream.hpp",
               SOURCE / "Rapfi/external/lz4/src/xxhash.c"]
    headers += sorted((SOURCE / "Rapfi/external/simde/include").rglob("*.h"))
    for path in headers:
        content = path.read_text(encoding="utf-8")
        start = content.find("/*")
        end = content.find("*/", start)
        if start >= 0 and end >= 0:
            sections.append((path.relative_to(SOURCE).as_posix(), content[start:end + 2]))
    for relative in ["LICENSE", "system/lib/libc/musl/COPYRIGHT",
                     "system/lib/libcxx/LICENSE.TXT", "system/lib/libcxxabi/LICENSE.TXT",
                     "system/lib/libunwind/LICENSE.TXT", "system/lib/compiler-rt/LICENSE.TXT"]:
        path = emsdk / "upstream" / "emscripten" / relative
        sections.append(("Emscripten-3.1.64/" + relative, path.read_text(encoding="utf-8")))
    text = "Upstream dependency and WebAssembly runtime notices\n\n"
    text += "\n\n".join(f"=== {name} ===\n\n{content.strip()}" for name, content in sections)
    (OUTPUT / "NOTICE-Dependencies.txt").write_text(text + "\n", encoding="utf-8", newline="\n")


def main():
    CACHE.mkdir(exist_ok=True)
    if not SOURCE.exists():
        run("git", "-c", "core.autocrlf=false", "clone", "--branch", "250615", "--depth", "1",
            "https://github.com/dhbloo/rapfi.git", SOURCE)
    for folder, expected in [(SOURCE, RAPFI_COMMIT), (SOURCE / "Networks", NETWORK_COMMIT)]:
        if folder.name == "Networks":
            run("git", "submodule", "update", "--init", "--depth", "1", "Networks", cwd=SOURCE)
        actual = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=folder, text=True).strip()
        if actual != expected:
            raise RuntimeError(f"Unexpected source revision: {folder}: {actual}")

    emsdk = Path(os.environ.get("EMSDK", CACHE / "emsdk"))
    os.environ["EMSDK"] = str(emsdk)
    if (emsdk / ".emscripten").exists():
        os.environ["EM_CONFIG"] = str(emsdk / ".emscripten")
    local_bins = [CACHE / "build-tools" / "cmake" / "data" / "bin",
                  CACHE / "build-tools" / "bin"]
    os.environ["PATH"] = os.pathsep.join(str(p) for p in local_bins if p.exists()) + os.pathsep + os.environ["PATH"]
    emcc = emsdk / "upstream" / "emscripten" / "emcc.py"
    compiler = subprocess.check_output(["python", str(emcc), "--version"], text=True)
    if SDK_VERSION not in compiler.splitlines()[0]:
        raise RuntimeError(f"Expected Emscripten {SDK_VERSION}: {compiler}")

    patches = sorted((ROOT / "scripts" / "patches").glob("*.patch"))
    for patch in patches:
        already_applied = subprocess.run(["git", "apply", "--reverse", "--check", str(patch)],
                                         cwd=SOURCE, capture_output=True).returncode == 0
        if not already_applied:
            run("git", "apply", patch, cwd=SOURCE)
    # Package only the rules used by this app.
    networks = SOURCE / "Networks"
    config = (networks / "config-example" / "gomocalc-mix9svq.toml").read_text(encoding="utf-8")
    config = config.replace('coord_conversion_mode = "X_flipY"', 'coord_conversion_mode = "none"')
    config = re.sub(r'\[\[model\.evaluator\.weights\]\]\s*weight_file = "mix9svqstandard[^\n]+\n', '', config)
    config = re.sub(r'\[\[model\.evaluator\.weights\]\]\s*weight_file_black[^\n]+\nweight_file_white[^\n]+\n', '', config)
    (networks / "studio-config.toml").write_text(config, encoding="utf-8", newline="\n")
    (networks / "wasm_preloads.txt").write_text(
        "studio-config.toml@config.toml\n"
        "classical/model210901.bin@model210901.bin\n"
        "mix9svq/mix9svqfreestyle_bsmix.bin.lz4@mix9svqfreestyle_bsmix.bin.lz4\n",
        encoding="utf-8", newline="\n")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "config.toml").write_text(config, encoding="utf-8", newline="\n")
    # Read license blobs directly so host Git line-ending settings cannot
    # change the distribution checksums.
    license_text = subprocess.check_output(["git", "show", "HEAD:Copying.txt"], cwd=SOURCE)
    (ROOT / "LICENSE").write_bytes(license_text)
    (OUTPUT / "COPYING-Rapfi.txt").write_bytes(license_text)
    (OUTPUT / "LICENSE-Networks.txt").write_bytes(
        subprocess.check_output(["git", "show", "HEAD:LICENSE"], cwd=networks))
    dependency_notices(emsdk)

    # Emscripten's CMake driver uses the activated toolchain environment.
    emcmake = emsdk / "upstream" / "emscripten" / "emcmake.py"
    cmake = shutil.which("cmake")
    if not cmake:
        raise RuntimeError("cmake must be on PATH")
    built_data_hash = None
    variants = []
    for multi, simd in [(False, True), (True, True), (False, False), (True, False)]:
        name = "rapfi-" + ("multi" if multi else "single") + ("-simd128" if simd else "")
        build = CACHE / "build" / name
        run("python", emcmake, cmake, "-S", SOURCE / "Rapfi", "-B", build, "-G", "Ninja",
            "-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_POLICY_VERSION_MINIMUM=3.5",
            "-DNO_COMMAND_MODULES=ON", f"-DNO_MULTI_THREADING={'OFF' if multi else 'ON'}",
            f"-DUSE_WASM_SIMD={'ON' if simd else 'OFF'}", "-DUSE_WASM_SIMD_RELAXED=OFF",
            "-DUSE_SSE=OFF", "-DUSE_AVX2=OFF", "-DUSE_AVX512=OFF", "-DUSE_BMI2=OFF",
            "-DUSE_VNNI=OFF", "-DUSE_NEON=OFF", "-DUSE_NEON_DOTPROD=OFF")
        run(cmake, "--build", build, "--parallel", str(min(8, os.cpu_count() or 2)))
        for suffix in [".js", ".wasm", ".worker.js"]:
            artifact = build / (name + suffix)
            if artifact.exists():
                shutil.copyfile(artifact, OUTPUT / artifact.name)
        data = build / (name + ".data")
        if built_data_hash and digest(data) != built_data_hash:
            raise RuntimeError("All variants must share identical data")
        built_data_hash = digest(data)
        shutil.copyfile(data, OUTPUT / "rapfi.data")
        variants.append(name)
        print(f"Built {name}", flush=True)

    files = {p.name: {"bytes": p.stat().st_size, "sha256": digest(p)}
             for p in sorted(OUTPUT.iterdir()) if p.is_file() and p.name != "manifest.json"}
    manifest = {"engine": "Rapfi", "release": "250615", "sourceCommit": RAPFI_COMMIT,
                "networksCommit": NETWORK_COMMIT, "emscripten": SDK_VERSION,
                "rules": "freestyle-15", "evaluator": "mix9svq",
                "patches": {patch.name: digest(patch) for patch in patches},
                "variants": variants, "files": files}
    if (emsdk / ".git").exists():
        manifest["emsdkCommit"] = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=emsdk, text=True).strip()
    manifest["cmake"] = subprocess.check_output([cmake, "--version"], text=True).splitlines()[0]
    manifest["ninja"] = subprocess.check_output(["ninja", "--version"], text=True).strip()
    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print("Distribution and SHA-256 manifest written to", OUTPUT)


if __name__ == "__main__":
    main()
