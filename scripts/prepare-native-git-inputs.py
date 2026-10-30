"""Fetch explicitly selected, already pinned NEW native-build source inputs.

Existing trees are inspected, never reset/cleaned. Submodules are recorded but
not implicitly fetched; top-level source presence is not dependency closure.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]


def selected_inputs(proposal, names):
    sources = {s["id"]: s for s in proposal["sources"]}
    if not names or len(set(names)) != len(names):
        raise ValueError("Select distinct explicit source IDs")
    result = []
    for name in names:
        source = sources.get(name)
        if source is None or not re.fullmatch(r"[a-zA-Z0-9_-]+", name):
            raise ValueError("Unknown pinned source: " + name)
        url = urlsplit(source.get("repository", ""))
        if not re.fullmatch(r"[a-f0-9]{40}", source.get("revision", "")) or url.scheme != "https" or not url.hostname or url.username or url.password or url.query or url.fragment:
            raise ValueError("Expected a pinned HTTPS Git source: " + name)
        result.append(source)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("components", nargs="+")
    parser.add_argument("--fetch", action="store_true")
    parser.add_argument("--proposal", type=Path, default=ROOT / "ci/native-rebuild-source-proposal.json")
    args = parser.parse_args()
    proposal = json.loads(args.proposal.read_text(encoding="utf8"))
    sources = selected_inputs(proposal, args.components)
    base = ROOT / "build/native-git-inputs"
    base.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(base).free < 2 * 1024**3:
        raise SystemExit("At least 2 GiB free space required")
    for source in sources:
        name, revision = source["id"], source["revision"]
        folder = base / (name + "-" + revision[:12])
        log = base / (name + "-" + revision[:12] + ".log")
        if not folder.exists():
            if not args.fetch:
                raise SystemExit("Missing offline source: " + name)
            with log.open("w") as stream:
                for command in (["git", "init", str(folder)],
                                ["git", "-C", str(folder), "config", "core.autocrlf", "false"],
                                ["git", "-C", str(folder), "fetch", "--depth=1", source["repository"], revision],
                                ["git", "-C", str(folder), "checkout", "--detach", "FETCH_HEAD"]):
                    subprocess.run(command, stdout=stream, stderr=subprocess.STDOUT, check=True, timeout=90)
        top = subprocess.run(["git", "-C", str(folder), "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True, timeout=15).stdout.strip()
        if Path(top).resolve() != folder.resolve():
            raise ValueError("Source must own a standalone Git tree")
        actual = subprocess.run(["git", "-C", str(folder), "rev-parse", "HEAD"], capture_output=True, text=True, check=True, timeout=15).stdout.strip()
        dirty = subprocess.run(["git", "-C", str(folder), "status", "--porcelain", "--untracked-files=all"], capture_output=True, text=True, check=True, timeout=15).stdout
        if actual != revision or dirty:
            raise ValueError("Existing source differs; preserved without reset: " + name)
        archive = base / (name + "-" + revision[:12] + ".tar")
        metadata_file = archive.with_suffix(".json")
        if archive.exists():
            if not metadata_file.exists():
                raise ValueError("Unrecorded existing archive preserved for inspection: " + name)
            previous = json.loads(metadata_file.read_text(encoding="utf8"))
            if previous["revision"] != revision or previous["repository"] != source["repository"] or hashlib.sha256(archive.read_bytes()).hexdigest() != previous["archiveSha256"]:
                raise ValueError("Existing source archive differs; preserved: " + name)
        if not archive.exists():
            with archive.open("xb") as stream:
                subprocess.run(["git", "-C", str(folder), "archive", revision], stdout=stream, check=True, timeout=30)
        gitmodules = folder / ".gitmodules"
        record = {"id": name, "repository": source["repository"], "revision": revision,
                  "sourceFolder": folder.relative_to(ROOT).as_posix(),
                  "archive": archive.relative_to(ROOT).as_posix(),
                  "archiveSha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
                  "topLevelSourceVerified": True,
                  "gitmodules": gitmodules.read_text(encoding="utf8") if gitmodules.exists() else None,
                  "submodulesVerified": not gitmodules.exists(),
                  "dependencyClosureVerified": False, "buildVerified": False, "distributionReady": False}
        metadata_file.write_text(json.dumps(record, indent=2) + "\n", encoding="utf8")
        print(json.dumps(record), flush=True)
