"""Build the scoped D3D11 libplacebo candidate with real shader/color libraries.

This candidate intentionally tests D3D11 only. Other GPU backends and libdovi
are not admitted by this harness; do not replace the application runtime with it.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from native_source_replay import replay_context

ROOT = Path(__file__).resolve().parents[1]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-materials", type=Path)
    parser.add_argument("--render-deps", type=Path)
    parser.add_argument("--shaderc", type=Path)
    args = parser.parse_args()
    if os.name == "nt":
        raise SystemExit("Use Ubuntu WSL Python")
    source_root, replay = replay_context(args.source_materials, __file__)
    if replay:
        if args.render_deps is None or args.shaderc is None:
            raise ValueError("Replay requires the freshly built and Windows-tested dependency prefixes")
        for stage, prefix in ((args.render_deps, "render-deps-replay-"), (args.shaderc, "shaderc-source-replay-")):
            if stage.absolute() != stage.resolve() or stage.parent != ROOT / "build" or not stage.name.startswith(prefix):
                raise ValueError("Expected owned replay dependency prefix")
        deps, shader = args.render_deps, args.shaderc
    else:
        if args.render_deps or args.shaderc:
            raise ValueError("Explicit replay dependencies require --source-materials")
        deps = Path(json.loads((ROOT / "build/render-deps-cross-latest.json").read_text())["folder"])
        shader = Path(json.loads((ROOT / "build/shaderc-windows-cross-latest.json").read_text())["folder"])
    for component in (deps, shader):
        dependency = json.loads((component / "report.json").read_text())
        assert dependency["windowsExecutionPassed"]
        if replay:
            assert dependency["sourceMaterialsReplay"]["inventorySha256"] == replay["inventorySha256"]
    folder = Path(tempfile.mkdtemp(prefix="libplacebo-source-replay-" if replay else "libplacebo-windows-cross-", dir=ROOT / "build"))
    marker = "libplacebo-source-replay-latest.json" if replay else "libplacebo-windows-cross-latest.json"
    (ROOT / "build" / marker).write_text(json.dumps({"folder": str(folder)}) + "\n")
    proposal = json.loads((source_root / "ci/native-rebuild-source-proposal.json").read_text())
    header_cohort = json.loads((source_root / "ci/native-libplacebo-dependencies.json").read_text())
    assert next(s for s in proposal["sources"] if s["id"] == "libplacebo")["revision"] == header_cohort["parentRevision"]
    proposal["sources"].extend(header_cohort["sources"])
    tree, output, prefix = folder / "source", folder / "build", folder / "install"
    tree.mkdir()
    records = []
    for name, target in (("libplacebo", tree), ("fast_float", tree / "3rdparty/fast_float"),
                         ("libplacebo-vulkan-headers", tree / "3rdparty/Vulkan-Headers")):
        source = next(s for s in proposal["sources"] if s["id"] == name)
        archive = source_root / "build/native-git-inputs" / (name + "-" + source["revision"][:12] + ".tar")
        record = json.loads(archive.with_suffix(".json").read_text())
        assert hashlib.sha256(archive.read_bytes()).hexdigest() == record["archiveSha256"]
        target.mkdir(parents=True, exist_ok=True)
        subprocess.run(["tar", "--extract", "--file", str(archive), "--directory", str(target),
                        "--no-same-owner", "--no-same-permissions"], check=True, timeout=90)
        records.append(record)
    tools = ROOT / "build/native-cross-tools/root/usr"
    crossfile = folder / "windows-x64.ini"
    text = (deps / "windows-x64.ini").read_text()
    text = text.replace(str(deps / "install/lib/pkgconfig"), str(deps / "install/lib/pkgconfig") + ":" + str(shader / "install/lib/pkgconfig"))
    text = text.replace("[properties]", "dlltool = '" + str(ROOT / "build/native-cross-tools/bin/x86_64-w64-mingw32-dlltool") + "'\n[properties]")
    crossfile.write_text(text)
    env = {**os.environ, "PATH": str(tools / "bin") + os.pathsep + os.environ["PATH"],
           "PYTHONPATH": str(tools / "lib/python3/dist-packages"),
           "LD_LIBRARY_PATH": str(tools / "lib/x86_64-linux-gnu"), "GIT_CEILING_DIRECTORIES": str(folder)}
    report = {"kind": "scoped-d3d11-libplacebo-windows-build-not-application-admission", "sources": records,
              "dependencyFolders": [str(p.relative_to(ROOT)) for p in (deps, shader)],
              "backends": {"d3d11": True, "vulkan": False, "opengl": False}, "libdovi": False,
              "buildPassed": False, "windowsTestsPassed": False, "currentRuntimeReplaced": False, "distributionReady": False}
    if replay:
        report["sourceMaterialsReplay"] = replay
    command = ["/usr/bin/python3", "-m", "mesonbuild.mesonmain", "setup", str(output), str(tree),
               "--cross-file=" + str(crossfile), "--prefix=" + str(prefix), "--libdir=lib",
               "--buildtype=release", "--default-library=shared", "-Ddemos=false", "-Dtests=true",
               "-Dd3d11=enabled", "-Dshaderc=enabled", "-Dlcms=enabled", "-Dxxhash=enabled",
               "-Dvulkan=disabled", "-Dopengl=disabled", "-Dglslang=disabled", "-Dlibdovi=disabled"]
    report["configureArguments"] = command
    (folder / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    for label, invocation in (("configure", command), ("build", [str(tools / "bin/ninja"), "-C", str(output), "-j4"]),
                              ("install", [str(tools / "bin/ninja"), "-C", str(output), "install"])):
        with (folder / (label + ".log")).open("w") as stream:
            subprocess.run(invocation, env=env, stdout=stream, stderr=subprocess.STDOUT, check=True, timeout=900)
        print(label + " passed", flush=True)
    for component in (deps, shader):
        for binary in (component / "install/bin").glob("*.dll"):
            destination = prefix / "bin" / binary.name
            if destination.exists():
                assert destination.read_bytes() == binary.read_bytes(), "Conflicting runtime dependency"
            else:
                shutil.copyfile(binary, destination)
    report.update(buildPassed=True, binaries=[{"path": p.relative_to(folder).as_posix(), "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                  for p in sorted((prefix / "bin").glob("*.dll"))])
    (folder / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"folder": str(folder), "buildPassed": True, "distributionReady": False}))
