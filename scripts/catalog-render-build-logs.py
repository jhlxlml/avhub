"""Extract configuration evidence, never infer binary revisions from versions."""
import argparse
import hashlib
import json
from pathlib import Path, PureWindowsPath
import re
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ARTIFACT_SHA = "7a25f827f79c2f44bbce7845a75174bcd59e356ddfd9d3d89a90d7b5c18ca65b"


def parse_config(text):
    project_name = re.search(r"^Project name: (.+)$", text, re.M)
    project_version = re.search(r"^Project version: (.+)$", text, re.M)
    dependencies = []
    for line in text.splitlines():
        match = re.fullmatch(r"Run-time dependency ([\w.+-]+) found: (YES|NO)(?:\s+(.*))?", line)
        if match:
            value = (match[3] or "").removesuffix(" (cached)").strip()
            dependencies.append({"name": match[1], "found": match[2] == "YES", "version": value or None if match[2] == "YES" else None, "line": line})
    return {"projectName": project_name[1].strip() if project_name else None, "projectVersion": project_version[1].strip() if project_version else None, "dependencies": dependencies}


def collect(root=ROOT):
    base = root / "build/m5-source-inputs"
    if hashlib.sha256((base / "64_logs.zip").read_bytes()).hexdigest() != ARTIFACT_SHA:
        raise ValueError("Wrong fixed workflow artifact")
    archive = base / "64_logs.7z"
    with zipfile.ZipFile(base / "64_logs.zip") as source:
        if hashlib.sha256(source.read("logs.7z")).digest() != hashlib.sha256(archive.read_bytes()).digest():
            raise ValueError("Inner build logs differ from fixed artifact")
    seven = "C:/Program Files/7-Zip/7z.exe"
    listing = subprocess.check_output([seven, "l", "-slt", str(archive)], text=True, encoding="utf8")
    members = re.findall(r"^Path = (.+-configure-out\.log)$", listing, re.M)
    observations = []
    for member in sorted(members):
        name = PureWindowsPath(member.strip())
        if name.is_absolute() or ".." in name.parts:
            raise ValueError("Invalid configuration member")
        # Read the exact member from the verified artifact, not a possibly
        # stale extracted directory left by another local audit.
        raw = subprocess.check_output([seven, "e", "-so", "-spd", str(archive), str(name)], timeout=30)
        if len(raw) > 16 * 1024**2:
            raise ValueError("Oversize configuration log")
        parsed = parse_config(raw.decode("utf8", errors="replace"))
        if parsed["projectName"] or parsed["dependencies"]:
            observations.append({"artifactMember": name.as_posix(), "sha256": hashlib.sha256(raw).hexdigest(), **parsed})
    mpv = next(o for o in observations if o["artifactMember"].endswith("mpv-stamp/mpv-configure-out.log"))
    return {"schema": 1, "subject": {"dllSha256": "ea82215b32d8e5c8ed8e41b97659a5bf7c0ed0d1861d1baa61e6a6500a8ffe74", "runId": 40191236015, "jobId": 121162536770, "artifactId": 12599005134, "artifactName": "64_logs", "artifactSha256": ARTIFACT_SHA}, "scope": "Actual configuration logs from the fixed x64 GPL job; cached project versions do not establish precise source commits or complete binary inclusion", "transitiveDependenciesVerified": False, "distributionReady": False, "mpvDependencies": mpv["dependencies"], "observations": observations}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    result = collect()
    target = ROOT / "third_party/libmpv-render-d3d11/build-observations.json"
    target.write_text(json.dumps(result, indent=2) + "\n", encoding="utf8")
    print(json.dumps({"configurationLogs": len(result["observations"]), "mpvDependenciesFound": sum(d["found"] for d in result["mpvDependencies"]), "distributionReady": False}))
