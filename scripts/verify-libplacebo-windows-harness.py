"""Run the actual candidate DLL plus official Windows CPU/D3D11 tests."""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
from native_source_replay import owned_build

ROOT = Path(__file__).resolve().parents[1]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build-dir", type=Path)
    args = parser.parse_args()
    if os.name != "nt":
        raise SystemExit("Use Windows Python")
    folder = owned_build(args.build_dir, "libplacebo-windows-cross-latest.json", r"libplacebo-(?:windows-cross|source-replay)-[a-z0-9_]+")
    build = json.loads((folder / "report.json").read_text()); assert build["buildPassed"]
    for binary in build["binaries"]:
        assert hashlib.sha256((folder / binary["path"]).read_bytes()).hexdigest() == binary["sha256"]
    prefix = folder / "install/bin"
    with os.add_dll_directory(str(prefix)):
        library = ctypes.CDLL(str(next(prefix.glob("libplacebo-*.dll"))))
        library.pl_version.restype = ctypes.c_char_p
        version = library.pl_version().decode("utf8")
    report = {"kind": "actual-windows-libplacebo-dll-and-official-tests-not-electron-acceptance",
              "dllLoaded": True, "version": version, "tests": [], "passed": False,
              "d3d11Passed": False, "distributionReady": False}
    tests = sorted((folder / "build/src/tests").glob("test.*.exe"), key=lambda p: ("d3d11" not in p.name, p.name))
    assert tests and any("d3d11" in p.name for p in tests)
    env = {**os.environ, "PATH": str(prefix) + os.pathsep + os.environ["PATH"]}
    for binary in tests:
        start = time.monotonic()
        with (folder / ("windows-" + binary.name + ".log")).open("wb") as stream:
            result = subprocess.run([str(binary)], cwd=prefix, env=env, stdout=stream, stderr=subprocess.STDOUT,
                                    timeout=180, creationflags=subprocess.CREATE_NO_WINDOW)
        report["tests"].append({"name": binary.name, "exitCode": result.returncode,
                                 "sha256": hashlib.sha256(binary.read_bytes()).hexdigest(), "seconds": time.monotonic()-start})
        if "d3d11" in binary.name:
            report["d3d11Passed"] = result.returncode == 0
        (folder / "windows-tests.json").write_text(json.dumps(report, indent=2) + "\n")
        print(binary.name + " exit=" + str(result.returncode), flush=True)
    report["passed"] = all(t["exitCode"] == 0 for t in report["tests"])
    (folder / "windows-tests.json").write_text(json.dumps(report, indent=2) + "\n")
    build.update(windowsTestsPassed=report["passed"], d3d11TestsPassed=report["d3d11Passed"], windowsTestReport="windows-tests.json")
    (folder / "report.json").write_text(json.dumps(build, indent=2) + "\n")
    print(json.dumps({"passed": report["passed"], "report": str(folder / "windows-tests.json")}))
    if not report["passed"]:
        raise SystemExit(1)
