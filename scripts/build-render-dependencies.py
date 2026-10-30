"""Build pinned Windows rendering dependencies in an owned prefix.

SPIRV-Cross uses its upstream shared C API without the old builder's static
linking patch. Actual DLL closure is staged and recorded, not assumed present.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from native_source_replay import replay_context

ROOT = Path(__file__).resolve().parents[1]


def run_step(folder, label, command, env):
    with (folder / (label + ".log")).open("w") as stream:
        subprocess.run(command, env=env, stdout=stream, stderr=subprocess.STDOUT, check=True, timeout=900)
    print(label + " passed", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-materials", type=Path)
    args = parser.parse_args()
    if os.name == "nt":
        raise SystemExit("Run with Ubuntu WSL Python")
    source_root, replay = replay_context(args.source_materials, __file__)
    folder = Path(tempfile.mkdtemp(prefix="render-deps-replay-" if replay else "render-deps-cross-", dir=ROOT / "build"))
    tools = ROOT / "build/native-cross-tools/root/usr"
    prefix = folder / "install"
    proposal = json.loads((source_root / "ci/native-rebuild-source-proposal.json").read_text())
    components = [s for s in proposal["sources"] if s["id"] in {"spirv-cross", "lcms2", "xxhash"}]
    env = {**os.environ, "PATH": str(tools / "bin") + os.pathsep + os.environ["PATH"],
           "PYTHONPATH": str(tools / "lib/python3/dist-packages"),
           "LD_LIBRARY_PATH": str(tools / "lib/x86_64-linux-gnu")}
    cross = str(ROOT / "build/native-cross-tools/bin/x86_64-w64-mingw32-")
    toolchain = folder / "windows-x64.cmake"
    toolchain.write_text(f'''set(CMAKE_SYSTEM_NAME Windows)
set(CMAKE_SYSTEM_PROCESSOR x86_64)
set(CMAKE_C_COMPILER "{cross}gcc")
set(CMAKE_CXX_COMPILER "{cross}g++")
set(CMAKE_RC_COMPILER "{cross}windres")
set(CMAKE_AR "{cross}ar")
set(CMAKE_RANLIB "{cross}ranlib")
set(CMAKE_FIND_ROOT_PATH "{prefix}" "{tools}/x86_64-w64-mingw32")
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)
''')
    meson_cross = folder / "windows-x64.ini"
    meson_cross.write_text(f'''[binaries]
c = '{cross}gcc'
cpp = '{cross}g++'
ar = '{cross}ar'
windres = '{cross}windres'
strip = '{cross}strip'
pkg-config = '{tools}/bin/pkgconf'
[properties]
needs_exe_wrapper = true
pkg_config_libdir = '{prefix}/lib/pkgconfig'
[host_machine]
system = 'windows'
cpu_family = 'x86_64'
cpu = 'x86_64'
endian = 'little'
''')
    shutil.copyfile(ROOT / "build/native-cross-tools/inputs.json", folder / "compiler-inputs.json")
    report = {"kind": "real-windows-render-dependencies-not-libmpv", "components": [],
              "buildPassed": False, "windowsExecutionPassed": False,
              "currentRuntimeReplaced": False, "distributionReady": False}
    if replay:
        report["sourceMaterialsReplay"] = replay
    marker = "render-deps-replay-latest.json" if replay else "render-deps-cross-latest.json"
    (ROOT / "build" / marker).write_text(json.dumps({"folder": str(folder)}) + "\n")
    (folder / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    for source in components:
        name = source["id"]
        archive = source_root / "build/native-git-inputs" / (name + "-" + source["revision"][:12] + ".tar")
        metadata = json.loads(archive.with_suffix(".json").read_text())
        if hashlib.sha256(archive.read_bytes()).hexdigest() != metadata["archiveSha256"]:
            raise ValueError("Fixed source differs: " + name)
        tree, output = folder / (name + "-source"), folder / (name + "-build")
        tree.mkdir()
        subprocess.run(["tar", "--extract", "--file", str(archive), "--directory", str(tree),
                        "--no-same-owner", "--no-same-permissions"], check=True, timeout=180)
        if name == "lcms2":
            run_step(folder, name + "-configure", ["/usr/bin/python3", "-m", "mesonbuild.mesonmain", "setup",
                     str(output), str(tree), "--cross-file=" + str(meson_cross), "--prefix=" + str(prefix),
                     "--libdir=lib", "--buildtype=release", "--default-library=shared",
                     "-Dtests=disabled", "-Djpeg=disabled", "-Dtiff=disabled", "-Dutils=false",
                     "-Dfastfloat=true", "-Dthreaded=true"], env)
            run_step(folder, name + "-build", [str(tools / "bin/ninja"), "-C", str(output), "-j4"], env)
            run_step(folder, name + "-install", [str(tools / "bin/ninja"), "-C", str(output), "install"], env)
        else:
            selected = tree / "build/cmake" if name == "xxhash" else tree
            options = ["-DSPIRV_CROSS_SHARED=ON", "-DSPIRV_CROSS_STATIC=OFF", "-DSPIRV_CROSS_CLI=OFF",
                       "-DSPIRV_CROSS_ENABLE_TESTS=OFF"] if name == "spirv-cross" else ["-DXXHASH_BUILD_XXHSUM=OFF"]
            run_step(folder, name + "-configure", ["cmake", "-S", str(selected), "-B", str(output), "-G", "Ninja",
                     "-DCMAKE_TOOLCHAIN_FILE=" + str(toolchain), "-DCMAKE_INSTALL_PREFIX=" + str(prefix),
                     "-DCMAKE_INSTALL_LIBDIR=lib", "-DCMAKE_BUILD_TYPE=Release", "-DBUILD_SHARED_LIBS=ON", *options], env)
            run_step(folder, name + "-build", ["cmake", "--build", str(output), "--parallel", "4"], env)
            run_step(folder, name + "-install", ["cmake", "--install", str(output)], env)
        report["components"].append({"id": name, "revision": source["revision"], "archiveSha256": metadata["archiveSha256"],
                                     "sourceTree": tree.relative_to(folder).as_posix(), "buildPassed": True})
        (folder / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    (prefix / "bin").mkdir(exist_ok=True)
    for name in ("libssp-0.dll", "libgcc_s_seh-1.dll", "libstdc++-6.dll"):
        shutil.copyfile(tools / "lib/gcc/x86_64-w64-mingw32/13-posix" / name, prefix / "bin" / name)
    shutil.copyfile(tools / "x86_64-w64-mingw32/lib/libwinpthread-1.dll", prefix / "bin/libwinpthread-1.dll")
    report.update(buildPassed=True, binaries=[{"path": p.relative_to(folder).as_posix(), "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                  for p in sorted((prefix / "bin").glob("*.dll"))])
    (folder / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"folder": str(folder), "buildPassed": True}))
