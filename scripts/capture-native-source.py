"""Capture one owned Git source tree, not an application package or build."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def capture(source, component, root=ROOT, limit=512 * 1024**2):
    root = root.resolve()
    owned = (root / "build").resolve()
    source = Path(source).resolve()
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", component) or not source.is_relative_to(owned) or source == owned:
        raise ValueError("Expected one source directory inside the owned build workspace")
    git = lambda *args: subprocess.check_output(["git", "-C", str(source), *args], encoding="utf8", errors="strict").rstrip("\r\n")
    if Path(git("rev-parse", "--show-toplevel")).resolve() != source:
        raise ValueError("Source must own its Git repository, not inherit AVHub's")
    revision = git("rev-parse", "HEAD")
    tree = git("rev-parse", "HEAD^{tree}")
    status = git("status", "--porcelain=v1", "--untracked-files=normal")
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise ValueError("Expected a complete Git revision")
    # Flatten only source links that resolve inside the owned workspace. Record
    # their provenance; this covers injected glad/fast_float/DNN inputs without
    # silently archiving a user's media directory or a recursive link cycle.
    pending = [(source, Path(), frozenset())]
    files, links, total = [], [], 0
    while pending:
        directory, relative, ancestors = pending.pop()
        physical = directory.resolve()
        if not physical.is_relative_to(owned) or physical in ancestors:
            raise ValueError("Source link leaves the owned workspace or cycles")
        for entry in sorted(directory.iterdir()):
            if entry.name == ".git":
                continue
            name = relative / entry.name
            target = entry.resolve()
            if not target.is_relative_to(owned):
                raise ValueError("Source link leaves the owned workspace")
            if entry.is_symlink() or entry.is_junction():
                links.append({"path": name.as_posix(), "ownedTarget": target.relative_to(root).as_posix()})
            if target.is_dir():
                pending.append((target, name, ancestors | {physical}))
            elif stat.S_ISREG(target.stat().st_mode):
                size = target.stat().st_size
                total += size
                if total > limit:
                    raise ValueError("Source snapshot exceeds configured size limit")
                files.append((name.as_posix(), target, size))
            else:
                raise ValueError("Unsupported source member")
    if shutil.disk_usage(owned).free < total + 128 * 1024**2:
        raise OSError("Insufficient space for source snapshot")
    output = Path(tempfile.mkdtemp(prefix="native-source-" + component + "-", dir=owned))
    archive = output / "source.zip"
    inventory = []
    with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED) as bundle:
        for name, file, size in sorted(files):
            digest = hashlib.sha256()
            count = 0
            # Fixed ZIP timestamps make source content, rather than checkout
            # mtimes, determine the archive. No .git object/config is copied.
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (stat.S_IMODE(file.stat().st_mode) | stat.S_IFREG) << 16
            with file.open("rb") as stream, bundle.open(info, "w") as target:
                while chunk := stream.read(1024**2):
                    count += len(chunk)
                    if count > size:
                        raise ValueError("Source changed during capture")
                    digest.update(chunk)
                    target.write(chunk)
            if count != size:
                raise ValueError("Source changed during capture")
            inventory.append({"path": name, "size": count, "sha256": digest.hexdigest()})
    if git("rev-parse", "HEAD") != revision or git("status", "--porcelain=v1", "--untracked-files=normal") != status:
        raise ValueError("Repository changed during capture")
    report = {"schema": 1, "component": component, "capturePlatform": sys.platform, "baseRevision": revision, "baseGitTree": tree, "gitStatus": status, "files": inventory, "sourceLinks": links, "archiveSha256": hashlib.sha256(archive.read_bytes()).hexdigest(), "scope": "One actual source-tree snapshot including untracked/ignored inputs, excluding .git; host-observed modes, not a portable compiler environment, build or complete dependency/source approval", "buildVerified": False, "distributionReady": False}
    (output / "source-record.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
    return {"folder": str(output), "record": report}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--component", required=True)
    args = parser.parse_args()
    result = capture(args.source_dir, args.component)
    print(json.dumps({"folder": result["folder"], "revision": result["record"]["baseRevision"], "files": len(result["record"]["files"]), "buildVerified": False}))
