"""Bounded archive preparation for the NEW source proposal, not old-DLL approval."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]


def verify(file, source):
    algorithm, expected = source["declaredHash"].split("=", 1)
    algorithm = algorithm.lower()
    if algorithm not in {"sha1", "sha256"} or not file.is_file() or file.is_symlink() or file.stat().st_size > 128 * 1024**2:
        raise ValueError("Invalid proposed archive")
    with file.open("rb") as stream:
        actual = hashlib.file_digest(stream, algorithm).hexdigest()
    if actual != expected.lower():
        raise ValueError("Recipe digest mismatch; existing input preserved")
    with file.open("rb") as stream:
        sha256 = hashlib.file_digest(stream, "sha256").hexdigest()
    return {"id": source["id"], "size": file.stat().st_size, "sha256": sha256, "recipeDigestMatched": True, "strongRecipeDigest": algorithm == "sha256", "buildVerified": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true", help="Allow missing official inputs to be fetched")
    parser.add_argument("--worker", help=argparse.SUPPRESS)
    parser.add_argument("--temporary", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    proposal = json.loads((ROOT / "ci/native-rebuild-source-proposal.json").read_text(encoding="utf8"))
    sources = [s for s in proposal["sources"] if s["state"] == "archive-hash-declared-not-downloaded"]
    folder = ROOT / "build/native-rebuild-archives"
    folder.mkdir(parents=True, exist_ok=True)
    if args.worker:
        source = next(s for s in sources if s["id"] == args.worker)
        temporary = args.temporary
        if temporary is None or temporary.resolve().parent != folder.resolve() or not temporary.name.startswith(source["id"] + "-") or temporary.is_symlink() or temporary.stat().st_size != 0:
            raise ValueError("Expected own empty temporary download file")
        with temporary.open("wb") as output, urlopen(source["url"], timeout=20) as response:
            size = 0
            while chunk := response.read(1024**2):
                size += len(chunk)
                if size > 128 * 1024**2:
                    raise ValueError("Archive exceeds source-input capacity")
                output.write(chunk)
        print(json.dumps(verify(temporary, source)))
    else:
        report = []
        for source in sources:
            target = folder / (source["id"] + "-" + source["url"].rsplit("/", 1)[1])
            if target.exists():
                result = verify(target, source)
                result["path"] = target.relative_to(ROOT).as_posix()
            elif not args.download:
                result = {"id": source["id"], "state": "missing-offline", "recipeDigestMatched": False}
            else:
                if shutil.disk_usage(folder).free < 256 * 1024**2:
                    raise OSError("Insufficient space for bounded source archive preparation")
                fd, name = tempfile.mkstemp(prefix=source["id"] + "-", suffix=".part", dir=folder)
                os.close(fd)
                temporary = Path(name)
                try:
                    # Socket timeouts alone did not bound the observed model
                    # request. This worker has no subprocesses; timeout kills
                    # exactly this downloader and cannot leave a network task.
                    child = subprocess.run([sys.executable, str(Path(__file__).resolve()), "--worker", source["id"], "--temporary", str(temporary)], capture_output=True, text=True, timeout=45)
                    if child.returncode:
                        result = {"id": source["id"], "state": "download-failed", "error": child.stderr[-1200:], "recipeDigestMatched": False}
                    else:
                        result = verify(temporary, source)
                        os.link(temporary, target)
                        result["path"] = target.relative_to(ROOT).as_posix()
                except subprocess.TimeoutExpired:
                    result = {"id": source["id"], "state": "hard-deadline-45s", "recipeDigestMatched": False}
                finally:
                    temporary.unlink(missing_ok=True)
            report.append(result)
            print(json.dumps(result), flush=True)
        (folder / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
