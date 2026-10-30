"""Inventory actual self-built PE imports; Windows verifies OS-only resolution.

Static imports do not cover runtime LoadLibrary calls, drivers or clean-machine
acceptance. Never fetch a missing DLL or copy files from System32.
"""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build-dir", type=Path, help="Explicit owned normal/replay build")
    args = parser.parse_args()
    selected = args.build_dir if args.build_dir else Path(json.loads((ROOT / "build/libmpv-windows-cross-latest.json").read_text())["folder"]).name
    name = Path(selected).name
    if not re.fullmatch(r"(?:libmpv-(?:windows-cross|source-replay|chain-replay)|desktop-mpv-build)-[a-z0-9_]+", name):
        raise ValueError("Expected owned libmpv build")
    folder = ROOT / "build" / name
    if args.build_dir and args.build_dir.absolute() != folder:
        raise ValueError("Explicit build must be a project-owned directory")
    target = folder / "import-audit.json"
    if os.name == "nt":
        report = json.loads(target.read_text())
        paths = []
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.GetModuleFileNameW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_uint]
        for library in report["externalStaticImports"]:
            if not re.fullmatch(r"[A-Za-z0-9_.-]+\.dll", library, re.I):
                raise ValueError("Unexpected import basename")
            loaded = ctypes.WinDLL(library, winmode=0x800)  # LOAD_LIBRARY_SEARCH_SYSTEM32
            buffer = ctypes.create_unicode_buffer(32768)
            assert kernel.GetModuleFileNameW(loaded._handle, buffer, len(buffer)) > 0
            paths.append({"name": library, "resolvedPath": buffer.value})
        report.update(windowsOsImportsResolved=True, osModules=paths)
        target.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps({"osImportsResolved": len(paths), "report": str(target)}))
    else:
        build = json.loads((folder / "report.json").read_text()); assert build["buildPassed"]
        bundled = {Path(b["path"]).name.lower() for b in build["binaries"]}
        objdump = ROOT / "build/native-cross-tools/root/usr/bin/x86_64-w64-mingw32-objdump"
        rows, external = [], set()
        for binary in build["binaries"]:
            file = folder / binary["path"]
            assert hashlib.sha256(file.read_bytes()).hexdigest() == binary["sha256"]
            output = subprocess.run([str(objdump), "-p", str(file)], capture_output=True, text=True, check=True, timeout=15).stdout
            imports = re.findall(r"DLL Name:\s*(\S+)", output)
            external.update(n.lower() for n in imports if n.lower() not in bundled)
            rows.append({"name": file.name, "sha256": binary["sha256"], "imports": imports})
        report = {"kind": "self-built-native-static-pe-import-audit", "binaries": rows,
                  "externalStaticImports": sorted(external), "windowsOsImportsResolved": False,
                  "dynamicImportsVerified": False, "distributionReady": False}
        target.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps({"binaries": len(rows), "externalStaticImports": len(external), "report": str(target)}))
