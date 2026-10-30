"""Build actual Windows shaderc using its reviewed DEPS-pinned cohort."""
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


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-materials", type=Path)
    args = parser.parse_args()
    if os.name == "nt":
        raise SystemExit("Use Ubuntu WSL Python")
    source_root, replay = replay_context(args.source_materials, __file__)
    base = source_root / "build/native-git-inputs"
    cohort = json.loads((source_root / "ci/native-shaderc-dependencies.json").read_text())
    proposal = json.loads((source_root / "ci/native-rebuild-source-proposal.json").read_text())
    parent = next(s for s in proposal["sources"] if s["id"] == "shaderc")
    assert parent["revision"] == cohort["parentRevision"]
    sources = [parent, *cohort["sources"]]
    folder = Path(tempfile.mkdtemp(prefix="shaderc-source-replay-" if replay else "shaderc-windows-cross-", dir=ROOT / "build"))
    marker = "shaderc-source-replay-latest.json" if replay else "shaderc-windows-cross-latest.json"
    (ROOT / "build" / marker).write_text(json.dumps({"folder": str(folder)}) + "\n")
    trees, records = {}, []
    for source in sources:
        name, revision = source["id"], source["revision"]
        archive = base / (name + "-" + revision[:12] + ".tar")
        record = json.loads(archive.with_suffix(".json").read_text())
        assert hashlib.sha256(archive.read_bytes()).hexdigest() == record["archiveSha256"]
        tree = folder / name
        tree.mkdir()
        subprocess.run(["tar", "--extract", "--file", str(archive), "--directory", str(tree),
                        "--no-same-owner", "--no-same-permissions"], check=True, timeout=180)
        trees[name] = tree
        records.append(record)
    assert hashlib.sha256((trees["shaderc"] / "DEPS").read_bytes()).hexdigest() == cohort["depsSha256"]
    tools = ROOT / "build/native-cross-tools/root/usr"
    cross = str(ROOT / "build/native-cross-tools/bin/x86_64-w64-mingw32-")
    prefix, output = folder / "install", folder / "build"
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
    env = {**os.environ, "PATH": str(tools / "bin") + os.pathsep + os.environ["PATH"]}
    report = {"kind": "real-windows-shaderc-build-not-libplacebo-render-acceptance",
              "sources": records, "buildPassed": False, "windowsExecutionPassed": False,
              "currentRuntimeReplaced": False, "distributionReady": False}
    if replay:
        report["sourceMaterialsReplay"] = replay
    (folder / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    command = ["cmake", "-S", str(trees["shaderc"]), "-B", str(output), "-G", "Ninja",
               "-DCMAKE_TOOLCHAIN_FILE=" + str(toolchain), "-DCMAKE_INSTALL_PREFIX=" + str(prefix),
               "-DCMAKE_BUILD_TYPE=Release", "-DSHADERC_SKIP_INSTALL=ON", "-DSHADERC_SKIP_TESTS=ON",
               "-DSHADERC_SKIP_EXAMPLES=ON", "-DSHADERC_SKIP_EXECUTABLES=ON",
               "-DSPIRV_SKIP_TESTS=ON", "-DSPIRV_SKIP_EXECUTABLES=ON", "-DENABLE_GLSLANG_BINARIES=OFF",
               "-DENABLE_SPIRV_TOOLS_INSTALL=ON",
               "-DSHADERC_GLSLANG_DIR=" + str(trees["shaderc-glslang"]),
               "-DSHADERC_SPIRV_TOOLS_DIR=" + str(trees["shaderc-spirv-tools"]),
               "-DSHADERC_SPIRV_HEADERS_DIR=" + str(trees["shaderc-spirv-headers"])]
    report["configureArguments"] = command
    (folder / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    for name, invocation in (("configure", command), ("build", ["cmake", "--build", str(output), "--target", "shaderc_shared", "shaderc-pkg-config", "--parallel", "4"])):
        with (folder / (name + ".log")).open("w") as stream:
            subprocess.run(invocation, env=env, stdout=stream, stderr=subprocess.STDOUT, check=True, timeout=1200)
        print(name + " passed", flush=True)
    (prefix / "bin").mkdir(parents=True); (prefix / "lib/pkgconfig").mkdir(parents=True)
    shutil.copytree(trees["shaderc"] / "libshaderc/include", prefix / "include")
    for binary in (output / "libshaderc").glob("*shaderc_shared*"):
        if binary.suffix == ".dll":
            shutil.copyfile(binary, prefix / "bin" / binary.name)
        elif binary.name.endswith(".dll.a"):
            shutil.copyfile(binary, prefix / "lib" / binary.name)
    shutil.copyfile(output / "shaderc.pc", prefix / "lib/pkgconfig/shaderc.pc")
    for name in ("libssp-0.dll", "libgcc_s_seh-1.dll", "libstdc++-6.dll"):
        shutil.copyfile(tools / "lib/gcc/x86_64-w64-mingw32/13-posix" / name, prefix / "bin" / name)
    shutil.copyfile(tools / "x86_64-w64-mingw32/lib/libwinpthread-1.dll", prefix / "bin/libwinpthread-1.dll")
    report.update(buildPassed=True, binaries=[{"path": p.relative_to(folder).as_posix(), "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                  for p in sorted((prefix / "bin").glob("*.dll"))])
    (folder / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"folder": str(folder), "buildPassed": True}))
