"""Inventory cached MinGW runtime origins and notices; not distribution approval.

Run with the existing WSL Python. No download, install, or package scripts.
Only regular archive members are read; no tar paths are extracted.
"""
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[1]


def capture():
    tools = ROOT / "build/native-cross-tools"
    inputs = json.loads((tools / "inputs.json").read_text())
    pin = json.loads((ROOT / "ci/self-built-render-runtime.json").read_text())
    identities = {item["name"]: item["sha256"] for item in pin["dependencies"]}
    expected = {
        "gcc-mingw-w64-x86-64-posix-runtime":
            {"libgcc_s_seh-1.dll", "libstdc++-6.dll", "libssp-0.dll"},
        "mingw-w64-x86-64-dev": {"libwinpthread-1.dll"},
        "gcc-mingw-w64-base": {"copyright"},
        "mingw-w64-common": {"copyright"},
    }
    destination = ROOT / "build/native-support-materials"
    destination.mkdir(exist_ok=True)
    report = {"schema": 1, "cohort": pin["id"], "packages": [], "files": [],
              "distributionReady": False,
              "remaining": ["Exact corresponding-source delivery and license review"]}
    for record in inputs["packages"]:
        name = record["package"]
        if name not in expected:
            continue
        archive = tools / "packages" / Path(record["filename"]).name
        if hashlib.sha256(archive.read_bytes()).hexdigest() != record["sha256"]:
            raise ValueError("Package identity changed: " + name)
        result = subprocess.run(["dpkg-deb", "--fsys-tarfile", str(archive)],
                                capture_output=True, check=True, timeout=60)
        matched = set()
        with tarfile.open(fileobj=io.BytesIO(result.stdout), mode="r:") as members:
            for member in members:
                base = Path(member.name).name
                if not member.isfile() or base not in expected[name]:
                    continue
                if base == "copyright" and member.name != f"./usr/share/doc/{name}/copyright":
                    continue
                content = members.extractfile(member).read()
                digest = hashlib.sha256(content).hexdigest()
                if base.endswith(".dll") and identities.get(base) != digest:
                    raise ValueError("Runtime differs from pinned cohort: " + base)
                target = f"notices/{name}/copyright" if base == "copyright" else None
                if target:
                    output = destination / target
                    output.parent.mkdir(parents=True, exist_ok=True)
                    output.write_bytes(content)
                report["files"].append({"name": base, "package": name,
                                        "member": member.name, "sha256": digest,
                                        "size": len(content), "noticeFile": target})
                matched.add(base)
        if matched != expected[name]:
            raise ValueError("Missing package members: " + name + repr(expected[name] - matched))
        report["packages"].append(record)
    if len(report["packages"]) != len(expected):
        raise ValueError("Required cached package record missing")
    license_text = (ROOT / "LICENSE").read_bytes()
    target = destination / "notices/avhub/LICENSE"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(license_text)
    report["projectLicense"] = {"path": "notices/avhub/LICENSE",
                                "sha256": hashlib.sha256(license_text).hexdigest()}
    (destination / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"report": str(destination / "report.json"),
                      "verifiedRuntimeDlls": 4, "noticeFiles": 3,
                      "distributionReady": False}))


if __name__ == "__main__":
    capture()
