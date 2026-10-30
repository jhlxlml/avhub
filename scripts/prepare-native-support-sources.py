"""Fetch/verify exact cached Ubuntu support sources, without installing/building.

Pinned DSC hashes are observed official HTTPS metadata, not signature approval.
Archive bytes must match both the lock and its pinned DSC SHA256 section.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import time
from urllib.parse import urlsplit
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]


def validate_sources(lock):
    sources = lock["sources"]
    if len(sources) != 3 or {s["id"] for s in sources} != {"gcc-13", "gcc-mingw-w64", "mingw-w64"}:
        raise ValueError("Expected the three exact support source packages")
    names = set()
    for source in sources:
        url = urlsplit(source["baseUrl"])
        if url.scheme != "https" or url.hostname not in {"archive.ubuntu.com", "launchpad.net"} or url.username or url.password or url.query or url.fragment or not source["baseUrl"].endswith("/"):
            raise ValueError("Expected official HTTPS source origin")
        if not source["archives"]:
            raise ValueError("Missing source payload")
        for item in [source["dsc"], *source["archives"]]:
            name = item["name"]
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.+~-]*", name) or name in names:
                raise ValueError("Invalid or duplicate source filename")
            names.add(name)
            if not re.fullmatch(r"[0-9a-f]{64}", item["sha256"]) or type(item["size"]) is not int or not 0 < item["size"] <= 128 * 1024**2:
                raise ValueError("Invalid source identity/size")
    return sources


def verify(file, item):
    if file.is_symlink() or not file.is_file() or file.stat().st_size != item["size"]:
        raise ValueError("Source size/type mismatch: " + item["name"])
    with file.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    if digest != item["sha256"]:
        raise ValueError("Source SHA256 mismatch: " + item["name"])


def verify_dsc(file, source):
    text = file.read_text(encoding="utf8")
    if re.findall(r"^Source: (.+)$", text, re.M) != [source["id"]] or re.findall(r"^Version: (.+)$", text, re.M) != [source["version"]]:
        raise ValueError("DSC package/version mismatch")
    section = re.search(r"^Checksums-Sha256:\n((?: [^\n]+\n)+)", text, re.M)
    if not section:
        raise ValueError("Missing DSC SHA256 section")
    rows = [row.split() for row in section[1].splitlines()]
    expected = [[item["sha256"], str(item["size"]), item["name"]] for item in source["archives"]]
    if rows != expected:
        raise ValueError("Source lock differs from pinned DSC")


def prepare(download=False, root=ROOT):
    lock = json.loads((root / "ci/native-support-sources.json").read_text(encoding="utf8"))
    sources = validate_sources(lock)
    folder = root / "build/native-support-source-inputs"
    folder.mkdir(parents=True, exist_ok=True)
    report = {"schema": 1, "sources": [], "allInputsVerified": False,
              "dscSignaturesVerified": False, "runtimeRebuiltFromTheseInputs": False,
              "distributionReady": False}
    for source in sources:
        entry = {"id": source["id"], "version": source["version"], "files": []}
        report["sources"].append(entry)
        for item in [source["dsc"], *source["archives"]]:
            target = folder / item["name"]
            if not target.exists():
                if not download:
                    raise FileNotFoundError("Missing offline source: " + item["name"])
                if shutil.disk_usage(folder).free < item["size"] + 256 * 1024**2:
                    raise OSError("Insufficient source-cache space")
                descriptor, name = tempfile.mkstemp(prefix="source-", suffix=".part", dir=folder)
                os.close(descriptor)
                temporary = Path(name)
                try:
                    start, count = time.monotonic(), 0
                    with urlopen(source["baseUrl"] + item["name"], timeout=20) as response, temporary.open("wb") as output:
                        while chunk := response.read(1024**2):
                            count += len(chunk)
                            if count > item["size"] or time.monotonic() - start > 180:
                                raise ValueError("Source download exceeds declared size/time bound")
                            output.write(chunk)
                    verify(temporary, item)
                    os.link(temporary, target)
                finally:
                    temporary.unlink(missing_ok=True)
            verify(target, item)
            if item is source["dsc"]:
                verify_dsc(target, source)
            entry["files"].append({**item, "url": source["baseUrl"] + item["name"],
                                   "path": target.relative_to(root).as_posix()})
            print(json.dumps({"verified": item["name"], "bytes": item["size"]}), flush=True)
    report["allInputsVerified"] = True
    (folder / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true")
    args = parser.parse_args()
    prepare(args.download)
