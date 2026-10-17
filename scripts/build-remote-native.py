"""Build the Windows x64 AVX2 Rapfi engine with the pinned source and weights."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache"
SOURCE = CACHE / "rapfi-native"
OUTPUT = ROOT / ".cache" / "remote-native-source"
RAPFI = "1be1551ced57e38d53ed58f6d74bf6f8b4bdc230"
NETWORKS = "918b757a129258e9e765f77fe17d507c2bb1a60b"
LLVM_RELEASE = "20260616"
LLVM_SHA256 = "b9b68a4d276e16fa25802aaba458e4638f64b3884c290aaccdc2d87083b6ca35"


def toolchain():
    name = f"llvm-mingw-{LLVM_RELEASE}-ucrt-x86_64"
    folder = CACHE / name
    if not folder.exists():
        archive = CACHE / f"{name}.zip"
        if not archive.exists():
            urllib.request.urlretrieve(f"https://github.com/mstorsjo/llvm-mingw/releases/download/{LLVM_RELEASE}/{name}.zip", archive)
        if hashlib.sha256(archive.read_bytes()).hexdigest() != LLVM_SHA256:
            raise RuntimeError("LLVM-MinGW archive checksum mismatch")
        with zipfile.ZipFile(archive) as package:
            package.extractall(CACHE)
    return folder


def main():
    if not SOURCE.exists():
        subprocess.run(["git", "-c", "core.autocrlf=false", "clone", "--depth", "1",
                        "--branch", "250615", "https://github.com/dhbloo/rapfi.git", str(SOURCE)], check=True)
    subprocess.run(["git", "submodule", "update", "--init", "--depth", "1", "Networks"], cwd=SOURCE, check=True)
    for folder, expected in [(SOURCE, RAPFI), (SOURCE / "Networks", NETWORKS)]:
        actual = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=folder, text=True).strip()
        if actual != expected:
            raise RuntimeError(f"Unexpected source revision: {actual}")
    # Native alignment fix preserves the pinned on-disk network layout.
    for patch in sorted((ROOT / "scripts/native-patches").glob("*.patch")):
        if subprocess.run(["git", "apply", "--reverse", "--check", str(patch)], cwd=SOURCE,
                          capture_output=True).returncode:
            subprocess.run(["git", "apply", str(patch)], cwd=SOURCE, check=True)
    llvm = toolchain()
    os.environ["PATH"] = os.pathsep.join([str(llvm / "bin"), str(CACHE / "build-tools/cmake/data/bin"),
                                         str(CACHE / "build-tools/bin"), os.environ["PATH"]])
    cmake = shutil.which("cmake")
    gcc, gxx = str(llvm / "bin/x86_64-w64-mingw32-clang.exe"), str(llvm / "bin/x86_64-w64-mingw32-clang++.exe")
    if not all([cmake, gcc, gxx]):
        raise RuntimeError("CMake and Ninja must be available")
    build = CACHE / "native-build"
    subprocess.run([cmake, "--fresh", "-S", str(SOURCE / "Rapfi"), "-B", str(build), "-G", "Ninja",
                    f"-DCMAKE_C_COMPILER={Path(gcc).as_posix()}", f"-DCMAKE_CXX_COMPILER={Path(gxx).as_posix()}",
                    "-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_POLICY_VERSION_MINIMUM=3.5",
                    "-DNO_COMMAND_MODULES=ON", "-DNO_MULTI_THREADING=OFF", "-DUSE_SSE=ON",
                    "-DUSE_AVX2=ON", "-DUSE_BMI2=ON", "-DUSE_AVX512=OFF", "-DUSE_VNNI=OFF",
                    "-DUSE_NEON=OFF", "-DUSE_NEON_DOTPROD=OFF", "-DUSE_WASM_SIMD=OFF"], check=True)
    cache = (build / "CMakeCache.txt").read_text(encoding="utf-8")
    for required in ["NO_COMMAND_MODULES:BOOL=ON", "NO_MULTI_THREADING:BOOL=OFF", "USE_VNNI:BOOL=OFF", "USE_AVX2:BOOL=ON"]:
        if required not in cache:
            raise RuntimeError(f"CMake did not preserve the required build option: {required}")
    subprocess.run([cmake, "--build", str(build), "--parallel", "8"], check=True)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(build / "pbrain-rapfi.exe", OUTPUT / "rapfi.exe")
    shutil.copyfile(ROOT / "engine/rapfi-250615/config.toml", OUTPUT / "config.toml")
    for source, name in [("classical/model210901.bin", "model210901.bin"),
                         ("mix9svq/mix9svqfreestyle_bsmix.bin.lz4", "mix9svqfreestyle_bsmix.bin.lz4")]:
        shutil.copyfile(SOURCE / "Networks" / source, OUTPUT / name)
    for source, name in [(ROOT / "LICENSE", "COPYING-Rapfi.txt"),
                         (ROOT / "engine/rapfi-250615/LICENSE-Networks.txt", "LICENSE-Networks.txt")]:
        shutil.copyfile(source, OUTPUT / name)
    # Preserve the source dependency notices; the portable package also carries
    # the Node.js and GCC runtime notices separately.
    shutil.copyfile(ROOT / "engine/rapfi-250615/NOTICE-Dependencies.txt", OUTPUT / "NOTICE-Dependencies.txt")
    manifest = {"engine": "Rapfi", "release": "250615", "sourceCommit": RAPFI, "networksCommit": NETWORKS,
                "platform": "windows-x64", "isa": "AVX2/FMA/BMI2", "evaluator": "mix9svq",
                "compiler": subprocess.check_output([gxx, "--version"], text=True).splitlines()[0],
                "toolchain": {"release": LLVM_RELEASE, "archiveSha256": LLVM_SHA256},
                "patches": {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((ROOT / "scripts/native-patches").glob("*.patch"))},
                "cmake": subprocess.check_output([cmake, "--version"], text=True).splitlines()[0],
                "files": {p.name: {"bytes": p.stat().st_size, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                          for p in sorted(OUTPUT.iterdir()) if p.is_file() and p.name != "manifest.json"}}
    (OUTPUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print("Native engine built:", OUTPUT)


if __name__ == "__main__":
    main()
