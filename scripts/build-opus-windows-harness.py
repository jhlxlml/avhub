"""Build real Windows Opus DLL/tests with workspace-local MinGW; not libmpv."""
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]


if __name__ == "__main__":
    if platform.system() != "Linux":
        raise SystemExit("Use the existing Ubuntu WSL Python")
    profile = json.loads((ROOT / "ci/native-rebuild-profile.json").read_text())
    source = ROOT / "build/opus-model-free-mr7oapgd/source"
    revision = subprocess.run(["git", "-C", str(source), "rev-parse", "HEAD"],
                              capture_output=True, text=True, check=True, timeout=15).stdout.strip()
    if revision != profile["opus"]["revision"]:
        raise ValueError("Reviewed Opus revision differs")
    tools = ROOT / "build/native-cross-tools/root/usr"
    folder = Path(tempfile.mkdtemp(prefix="opus-windows-cross-", dir=ROOT / "build"))
    compiler_inputs = folder / "compiler-inputs.json"
    shutil.copyfile(ROOT / "build/native-cross-tools/inputs.json", compiler_inputs)
    source_copy = folder / "source"
    source_copy.mkdir()
    archive = folder / "source.tar"
    with archive.open("wb") as stream:
        subprocess.run(["git", "-C", str(source), "archive", revision], stdout=stream, check=True, timeout=30)
    with tarfile.open(archive) as stream:
        stream.extractall(source_copy, filter="data")
    # Version metadata is a documented build input, not an invented source tag.
    (source_copy / "package_version").write_text('PACKAGE_VERSION="1.6.1-85-ga8b2545"\n')
    toolchain = folder / "windows-x64.cmake"
    toolchain.write_text(f'''set(CMAKE_SYSTEM_NAME Windows)
set(CMAKE_SYSTEM_PROCESSOR x86_64)
set(CMAKE_C_COMPILER "{tools}/bin/x86_64-w64-mingw32-gcc-posix")
set(CMAKE_RC_COMPILER "{tools}/bin/x86_64-w64-mingw32-windres")
set(CMAKE_AR "{tools}/bin/x86_64-w64-mingw32-ar")
set(CMAKE_RANLIB "{tools}/bin/x86_64-w64-mingw32-ranlib")
set(CMAKE_FIND_ROOT_PATH "{tools}/x86_64-w64-mingw32")
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)
''')
    env = {**os.environ, "PATH": str(tools / "bin") + os.pathsep + os.environ["PATH"]}
    report = {"kind": "real-windows-cross-compiled-opus-harness-not-libmpv",
              "sourceRevision": revision, "sourceArchiveSha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
              "toolchainSha256": hashlib.sha256(toolchain.read_bytes()).hexdigest(),
              "compilerInputs": "compiler-inputs.json",
              "compilerInputsSha256": hashlib.sha256(compiler_inputs.read_bytes()).hexdigest(),
              "versionMetadataSha256": hashlib.sha256((source_copy / "package_version").read_bytes()).hexdigest(),
              "buildPassed": False,
              "windowsTestsPassed": False, "currentRuntimeReplaced": False, "distributionReady": False}
    (ROOT / "build/opus-windows-cross-latest.json").write_text(json.dumps({"folder": str(folder)}, indent=2) + "\n")
    (folder / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    common = ["-G", "Ninja", "-DCMAKE_TOOLCHAIN_FILE=" + str(toolchain),
              "-DCMAKE_BUILD_TYPE=Release", "-DCMAKE_EXPORT_COMPILE_COMMANDS=ON",
              *profile["opus"]["cmakeHarnessOptions"]]
    # Upstream deliberately builds its five conformance tests only for static
    # libraries. Build both configurations instead of relabeling DLL success.
    commands = [
        ("configure", ["cmake", "-S", str(source_copy), "-B", str(folder / "build"),
                       *common, "-DOPUS_BUILD_SHARED_LIBRARY=ON", "-DOPUS_BUILD_TESTING=OFF"]),
        ("build", ["cmake", "--build", str(folder / "build"), "--parallel", "4"]),
        ("configure-tests", ["cmake", "-S", str(source_copy), "-B", str(folder / "static-tests"),
                             *common, "-DOPUS_BUILD_SHARED_LIBRARY=OFF", "-DBUILD_SHARED_LIBS=OFF",
                             "-DOPUS_BUILD_TESTING=ON"]),
        ("build-tests", ["cmake", "--build", str(folder / "static-tests"), "--parallel", "4"]),
    ]
    for label, command in commands:
        with (folder / (label + ".log")).open("w") as stream:
            result = subprocess.run(command, stdout=stream, stderr=subprocess.STDOUT, env=env, timeout=300)
        if result.returncode:
            raise SystemExit(label + " failed; see " + str(folder / (label + ".log")))
        print(label + " passed", flush=True)
    units = json.loads((folder / "build/compile_commands.json").read_text())
    library_units = [u for u in units if "CMakeFiles/opus.dir/" in u["command"]]
    # Ubuntu MinGW enables stack protection, importing libssp. Keep that
    # protection and stage the verified compiler runtime alongside both users.
    support = tools / "lib/gcc/x86_64-w64-mingw32/13-posix/libssp-0.dll"
    for destination in (folder / "build", folder / "static-tests"):
        shutil.copyfile(support, destination / support.name)
    report.update(buildPassed=True, opusCompileUnits=len(library_units),
                  dnnCompileUnits=sum("/dnn/" in u["file"] for u in library_units),
                  supportRuntime={"name": support.name, "sha256": hashlib.sha256(support.read_bytes()).hexdigest(),
                                  "sourcePackage": "gcc-mingw-w64-x86-64-posix-runtime"},
                  binaries=[{"path": str(p.relative_to(folder)), "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                            for p in sorted(folder.glob("*/*")) if p.suffix in (".dll", ".exe")])
    (folder / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"folder": str(folder), "buildPassed": True, "windowsTestsPassed": False}))
