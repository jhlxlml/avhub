"""Build the pinned Windows AV1 decoder, retaining both 8/high-bit-depth paths."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from native_source_replay import replay_context, owned_build

ROOT = Path(__file__).resolve().parents[1]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-materials", type=Path)
    parser.add_argument("--render-deps", type=Path)
    args = parser.parse_args()
    if os.name == "nt":
        raise SystemExit("Use Ubuntu WSL Python")
    source_root, replay = replay_context(args.source_materials, __file__)
    if replay and not args.render_deps:
        raise ValueError("Replay requires an explicit cross-configuration template prefix")
    proposal = json.loads((source_root / "ci/native-rebuild-source-proposal.json").read_text())
    source = next(s for s in proposal["sources"] if s["id"] == "dav1d")
    archive = source_root / "build/native-git-inputs" / ("dav1d-" + source["revision"][:12] + ".tar")
    record = json.loads(archive.with_suffix(".json").read_text())
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == record["archiveSha256"]
    folder = Path(tempfile.mkdtemp(prefix="dav1d-source-replay-" if replay else "dav1d-windows-cross-", dir=ROOT / "build"))
    marker = "dav1d-source-replay-latest.json" if replay else "dav1d-windows-cross-latest.json"
    (ROOT / "build" / marker).write_text(json.dumps({"folder": str(folder)}) + "\n")
    tree, output, prefix = folder / "source", folder / "build", folder / "install"
    tree.mkdir()
    subprocess.run(["tar", "--extract", "--file", str(archive), "--directory", str(tree),
                    "--no-same-owner", "--no-same-permissions"], check=True, timeout=90)
    previous = owned_build(args.render_deps, "render-deps-cross-latest.json", r"render-deps-(?:cross|replay)-[a-z0-9_]+")
    crossfile = folder / "windows-x64.ini"
    crossfile.write_text((previous / "windows-x64.ini").read_text().replace(str(previous / "install"), str(prefix)))
    tools = ROOT / "build/native-cross-tools/root/usr"
    env = {**os.environ, "PATH": str(tools / "bin") + os.pathsep + os.environ["PATH"],
           "PYTHONPATH": str(tools / "lib/python3/dist-packages"), "LD_LIBRARY_PATH": str(tools / "lib/x86_64-linux-gnu")}
    report = {"kind": "fixed-windows-dav1d-dependency-not-application-acceptance", "source": record,
              "configuredBitdepthFamilies": [8, 16], "buildPassed": False, "distributionReady": False}
    if replay:
        report["sourceMaterialsReplay"] = replay
        report["crossConfigurationTemplate"] = previous.relative_to(ROOT).as_posix()
    (folder / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    for label, command in (
        ("configure", ["/usr/bin/python3", "-m", "mesonbuild.mesonmain", "setup", str(output), str(tree),
                       "--cross-file=" + str(crossfile), "--prefix=" + str(prefix), "--libdir=lib",
                       "--buildtype=release", "--default-library=shared", "-Dbitdepths=8,16",
                       "-Denable_tools=false", "-Denable_tests=false", "-Denable_docs=false"]),
        ("build", [str(tools / "bin/ninja"), "-C", str(output), "-j4"]),
        ("install", [str(tools / "bin/ninja"), "-C", str(output), "install"]),
    ):
        with (folder / (label + ".log")).open("w") as stream:
            subprocess.run(command, env=env, stdout=stream, stderr=subprocess.STDOUT, check=True, timeout=600)
        print(label + " passed", flush=True)
    for name in ("libssp-0.dll", "libgcc_s_seh-1.dll"):
        shutil.copyfile(tools / "lib/gcc/x86_64-w64-mingw32/13-posix" / name, prefix / "bin" / name)
    shutil.copyfile(tools / "x86_64-w64-mingw32/lib/libwinpthread-1.dll", prefix / "bin/libwinpthread-1.dll")
    report.update(buildPassed=True, binaries=[{"path": p.relative_to(folder).as_posix(), "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                  for p in sorted((prefix / "bin").glob("*.dll"))])
    (folder / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"folder": str(folder), "buildPassed": True}))
