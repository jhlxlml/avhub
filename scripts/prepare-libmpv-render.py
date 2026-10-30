"""Pinned M2 input preparation; never installs into bin/mpv or changes defaults."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tempfile
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def owned(path, root):
    root = root.resolve()
    if not path.absolute().is_relative_to(root):
        raise ValueError("Path outside workspace")
    cursor = path
    while cursor != root:
        if cursor.is_symlink() or cursor.is_junction():
            raise ValueError("Redirected preparation path")
        cursor = cursor.parent
    return path


def metadata(root, candidate="render"):
    if candidate not in {"render", "d3d11"}:
        raise ValueError("Unknown fixed candidate")
    manifest = json.loads((root / ("ci/libmpv-render-candidate.json" if candidate == "render" else "ci/libmpv-d3d11-candidate.json")).read_text())
    tag = manifest["releaseTag"]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}-[a-f0-9]{10}", tag):
        raise ValueError("Invalid fixed release")
    asset = "mpv-dev-x86_64-" + tag[:10].replace("-", "") + "-git-" + tag[11:] + ".7z"
    if manifest["url"] != "https://github.com/zhongfly/mpv-winbuild/releases/download/" + tag + "/" + asset:
        raise ValueError("Unexpected binary source")
    if not re.fullmatch("[a-f0-9]{40}", manifest["sourceCommit"]) or not manifest["sourceCommit"].startswith(tag[11:]):
        raise ValueError("Source commit mismatch")
    if not re.fullmatch("[a-f0-9]{64}", manifest["archiveSha256"]):
        raise ValueError("Invalid archive identity")
    names = set()
    for item in manifest["files"]:
        name = PurePosixPath(item["name"])
        if name.is_absolute() or ".." in name.parts or "\\" in str(name) or ":" in str(name) or str(name) in names:
            raise ValueError("Unsafe/duplicate member")
        if not re.fullmatch("[a-f0-9]{64}", item["sha256"]) or not 0 < item["size"] < 256 * 1024**2:
            raise ValueError("Invalid file identity")
        names.add(str(name))
    if names != {"libmpv-2.dll", "libmpv.dll.a", "include/mpv/client.h", "include/mpv/render.h", "include/mpv/render_gl.h", "include/mpv/stream_cb.h"}:
        raise ValueError("Unexpected file catalogue")
    dll = next(item for item in manifest["files"] if item["name"] == "libmpv-2.dll")
    if dll["sha256"] != manifest["dllSha256"] or dll["size"] != manifest["dllSize"]:
        raise ValueError("DLL identity mismatch")
    if candidate == "d3d11":
        header = manifest.get("supplementalHeader", {})
        if header.get("path") != "third_party/libmpv-render-d3d11/render_d3d11.h" or header.get("url") != "https://raw.githubusercontent.com/mpv-player/mpv/" + manifest["sourceCommit"] + "/include/mpv/render_d3d11.h":
            raise ValueError("Unverified D3D11 source header")
        source = owned(root / header["path"], root)
        if not source.is_file() or source.stat().st_size != header.get("size") or sha(source) != header.get("sha256"):
            raise ValueError("D3D11 source header identity mismatch")
    return manifest


def prepare(root=ROOT, offline=False, verify_only=False, candidate="render"):
    root = root.resolve()
    manifest = metadata(root, candidate)
    folder = owned(root / ("build/libmpv-render-spike" if candidate == "render" else "build/libmpv-d3d11-input"), root)
    folder.mkdir(parents=True, exist_ok=True)
    archive = owned(folder / manifest["url"].rsplit("/", 1)[1], root)
    if not archive.exists():
        if offline or verify_only:
            raise FileNotFoundError("Fixed archive missing; offline mode never downloads")
        if shutil.disk_usage(folder).free < 512 * 1024**2:
            raise OSError("Insufficient space for isolated Render API inputs")
        fd, temp = tempfile.mkstemp(prefix="download-", suffix=".part", dir=folder)
        try:
            with os.fdopen(fd, "wb") as target, urlopen(manifest["url"], timeout=60) as response:
                size = 0
                while chunk := response.read(1024 * 1024):
                    size += len(chunk)
                    if size > 256 * 1024**2:
                        raise ValueError("Archive exceeds limit")
                    target.write(chunk)
            if sha(Path(temp)) != manifest["archiveSha256"]:
                raise ValueError("Archive digest mismatch")
            os.link(temp, archive)
        finally:
            Path(temp).unlink(missing_ok=True)
    if sha(archive) != manifest["archiveSha256"]:
        raise ValueError("Archive digest mismatch; existing file preserved")
    runtime = owned(folder / "runtime", root)
    runtime.mkdir(exist_ok=True)
    known = {item["name"] for item in manifest["files"]}
    for entry in runtime.rglob("*"):
        owned(entry, root)
        if entry.is_file() and entry.relative_to(runtime).as_posix() not in known:
            raise ValueError("Unknown runtime member; refusing DLL search-path contamination")
    missing = sum(item["size"] for item in manifest["files"] if not (runtime / item["name"]).exists())
    if missing and shutil.disk_usage(folder).free < missing + 64 * 1024**2:
        raise OSError("Insufficient space for verified extraction")
    seven = Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "7-Zip/7z.exe"
    staged = []
    with tempfile.TemporaryDirectory(prefix="extract-", dir=folder) as temporary:
        for item in manifest["files"]:
            destination = owned(runtime / item["name"], root)
            if destination.exists():
                if not destination.is_file() or destination.stat().st_size != item["size"] or sha(destination) != item["sha256"]:
                    raise ValueError("Existing input differs; refusing overwrite: " + item["name"])
                continue
            if verify_only:
                raise FileNotFoundError(item["name"])
            if not seven.is_file():
                raise FileNotFoundError("7-Zip is needed only to extract the pinned input")
            temp = Path(temporary) / str(len(staged))
            with temp.open("wb") as target:
                result = subprocess.run([str(seven), "e", "-so", "-spd", str(archive), item["name"]], stdout=target, stderr=subprocess.PIPE, timeout=120)
            if result.returncode or temp.stat().st_size != item["size"] or sha(temp) != item["sha256"]:
                raise ValueError("Extracted file identity mismatch: " + item["name"])
            staged.append((temp, destination))
        # Publish only after every new file has passed verification. No overwrite.
        created = []
        try:
            for temp, destination in staged:
                destination.parent.mkdir(parents=True, exist_ok=True)
                os.link(temp, destination)
                created.append(destination)
        except BaseException:
            for destination in created:
                destination.unlink()
            raise
    return {"scope": "isolated M2 input, not installed production runtime", "dll": str(runtime / "libmpv-2.dll"), "verifiedFiles": len(manifest["files"]), "distributionReady": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--candidate", choices=["render", "d3d11"], default="render")
    args = parser.parse_args()
    print(json.dumps(prepare(offline=args.offline, verify_only=args.verify_only, candidate=args.candidate), indent=2))
