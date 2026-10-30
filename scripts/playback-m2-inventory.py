"""Read-only, offline M2 dependency evidence. Does not claim to run Render API."""
import hashlib
import json
import shutil
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def inventory():
    manifest = json.loads((ROOT / "ci/mpv-stable-candidate.json").read_text())
    sources = json.loads((ROOT / "ci/mpv-candidate-sources.json").read_text())
    runtime = ROOT / "build/mpv-stable-candidate/verified-runtime"
    files = []
    for item in manifest["files"]:
        path = runtime / item["name"]
        files.append({"name": item["name"], "matches": path.is_file()
                      and not path.is_symlink() and path.stat().st_size == item["size"]
                      and sha(path) == item["sha256"]})
    actual = sorted(p.name for p in runtime.iterdir() if p.suffix.lower() in (".exe", ".dll"))
    assert actual == sorted(item["name"] for item in files), "Unexpected runtime file"
    assert all(item["matches"] for item in files), "Candidate integrity failure"
    mpv = next(item for item in sources["archives"] if item["component"] == "mpv")
    archive = ROOT / "build/mpv-candidate-sources" / mpv["name"]
    assert sha(archive) == mpv["sha256"], "Source integrity failure"
    with zipfile.ZipFile(archive) as zipped:
        headers = [{"name": name.split("/", 1)[1],
                    "sha256": hashlib.sha256(zipped.read(name)).hexdigest()}
                   for name in zipped.namelist()
                   if name.endswith(("/include/mpv/render.h", "/include/mpv/render_gl.h", "/include/mpv/client.h"))]
    assert len(headers) == 3
    return {
        "scope": "offline dependency inventory, not Render API execution",
        "release": manifest["releaseTag"], "commit": manifest["sourceCommit"],
        "archiveSha256": manifest["archiveSha256"], "files": files,
        "libmpvDlls": [name for name in actual if name.lower().startswith("libmpv")],
        "headers": headers, "sourceArchiveSha256": mpv["sha256"],
        "pathTools": {name: shutil.which(name) for name in ("cl", "clang-cl", "clang", "gcc", "cmake", "meson", "ninja", "dotnet")},
        "frameworkCscExists": Path("C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe").is_file(),
        "renderApiExecuted": False, "packagedAcceptance": "not verified",
        "distributionReady": manifest["distributionReady"],
    }


if __name__ == "__main__":
    print(json.dumps(inventory(), ensure_ascii=False, indent=2))
