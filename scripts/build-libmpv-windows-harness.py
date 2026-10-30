"""Build a source-pinned SDR/D3D11 Windows libmpv candidate, not admission.

Uses the separately validated FFmpeg/render/font prefixes. The source manifest
and actual DLL closure remain beside the build. Never replace app defaults.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def replay_inputs(materials, root=ROOT):
    materials = materials.absolute()
    if materials.is_symlink() or materials.resolve() != materials or materials.parent != root / "build" or not materials.name.startswith("native-source-materials-"):
        raise ValueError("Expected an owned frozen source-materials directory")
    inventory = json.loads((materials / "inventory.json").read_text())
    if inventory["cohort"] != "selfbuilt-sdr-2cf60d001765" or inventory["distributionReady"]:
        raise ValueError("Unexpected source-materials cohort/approval")
    records = {item["path"]: item for item in inventory["files"]}
    proposal_name = "ci/native-rebuild-source-proposal.json"
    recipe_name = "scripts/build-libmpv-windows-harness.py"
    for name in (proposal_name, recipe_name):
        file = materials / name
        if file.is_symlink() or hashlib.sha256(file.read_bytes()).hexdigest() != records[name]["sha256"]:
            raise ValueError("Frozen replay input changed")
    if hashlib.sha256(Path(__file__).read_bytes()).hexdigest() != records[recipe_name]["sha256"]:
        raise ValueError("Re-stage materials to include the actual replay recipe")
    proposal = json.loads((materials / proposal_name).read_text())
    source = next(s for s in proposal["sources"] if s["id"] == "mpv")
    name = "build/native-git-inputs/mpv-" + source["revision"][:12] + ".tar"
    for relative in (name, Path(name).with_suffix(".json").as_posix()):
        file = materials / relative
        if file.is_symlink() or hashlib.sha256(file.read_bytes()).hexdigest() != records[relative]["sha256"]:
            raise ValueError("Frozen replay source changed")
    return materials, {"inventorySha256": hashlib.sha256((materials / "inventory.json").read_bytes()).hexdigest(),
                       "recipeSha256": records[recipe_name]["sha256"], "sourceArchiveSha256": records[name]["sha256"]}


def selected_dependencies(values, source_root, root=ROOT):
    expected = {"ffmpeg": "windowsExecutionPassed", "libplacebo": "windowsTestsPassed",
                "subtitle": "windowsTestsPassed", "shaderc": "windowsExecutionPassed",
                "render-deps": "windowsExecutionPassed"}
    stages = {}
    for value in values:
        name, separator, location = value.partition("=")
        if not separator or name not in expected or name in stages:
            raise ValueError("Select each of the five known dependency prefixes exactly once")
        stage = Path(location).absolute()
        if stage.parent != root / "build" or stage.is_symlink() or stage.resolve() != stage:
            raise ValueError("Expected an owned replay dependency prefix")
        report = json.loads((stage / "report.json").read_text())
        if not report["buildPassed"] or not report.get(expected[name]) or "sourceMaterialsReplay" not in report:
            raise ValueError("Dependency must be a rebuilt and Windows-validated replay")
        records = report.get("sources", report.get("components", []))
        if name == "ffmpeg":
            records = [{"id": "ffmpeg", "revision": report["sourceRevision"], "archiveSha256": report["sourceArchiveSha256"]}]
        for record in records:
            archive = source_root / "build/native-git-inputs" / (record["id"] + "-" + record["revision"][:12] + ".tar")
            if hashlib.sha256(archive.read_bytes()).hexdigest() != record["archiveSha256"]:
                raise ValueError("Dependency source differs from frozen chain input")
        for binary in report["binaries"]:
            if hashlib.sha256((stage / binary["path"]).read_bytes()).hexdigest() != binary["sha256"]:
                raise ValueError("Dependency binary changed")
        stages[name] = stage
    if set(stages) != set(expected):
        raise ValueError("Select all five replay dependency prefixes")
    # Keep include/library lookup order stable across explicit CLI ordering.
    return {name: stages[name] for name in expected}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-materials", type=Path, help="Replay a frozen dossier source/recipe using the verified existing dependency/toolchain prefixes")
    parser.add_argument("--dependency", action="append", default=[], help="NAME=absolute owned replay prefix; provide all five dependencies")
    args = parser.parse_args()
    if os.name == "nt":
        raise SystemExit("Use Ubuntu WSL Python")
    source_root, replay = replay_inputs(args.source_materials) if args.source_materials else (ROOT, None)
    names = ("ffmpeg", "libplacebo", "subtitle", "shaderc", "render-deps")
    if args.dependency and not replay:
        raise ValueError("Explicit replay dependencies require frozen source materials")
    stages = selected_dependencies(args.dependency, source_root) if args.dependency else {}
    if not args.dependency:
        for name in names:
            marker = "render-deps-cross-latest.json" if name == "render-deps" else name + "-windows-cross-latest.json"
            stage = Path(json.loads((ROOT / "build" / marker).read_text())["folder"])
            report = json.loads((stage / "report.json").read_text())
            assert report["buildPassed"], name + " build incomplete"
            stages[name] = stage
    ff_components = (stages["ffmpeg"] / "build/config_components.h").read_text()
    assert "#define CONFIG_PNG_ENCODER 1" in ff_components, "PNG screenshot encoder must be enabled"
    ff_report = json.loads((stages["ffmpeg"] / "report.json").read_text())
    expected_ff_version = "git-" + ff_report["sourceRevision"][:12]
    assert ff_report.get("explicitVersionRevision") == expected_ff_version
    assert 'FFMPEG_VERSION "' + expected_ff_version + '"' in (stages["ffmpeg"] / "install/include/libavutil/ffversion.h").read_text()
    proposal = json.loads((source_root / "ci/native-rebuild-source-proposal.json").read_text())
    source = next(s for s in proposal["sources"] if s["id"] == "mpv")
    archive = source_root / "build/native-git-inputs" / ("mpv-" + source["revision"][:12] + ".tar")
    metadata = json.loads(archive.with_suffix(".json").read_text())
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == metadata["archiveSha256"]
    folder = Path(tempfile.mkdtemp(prefix="libmpv-chain-replay-" if args.dependency else "libmpv-source-replay-" if replay else "libmpv-windows-cross-", dir=ROOT / "build"))
    marker = "libmpv-chain-replay-latest.json" if args.dependency else "libmpv-source-replay-latest.json" if replay else "libmpv-windows-cross-latest.json"
    (ROOT / "build" / marker).write_text(json.dumps({"folder": str(folder)}) + "\n")
    tree, output, prefix = folder / "source", folder / "build", folder / "install"
    tree.mkdir()
    subprocess.run(["tar", "--extract", "--file", str(archive), "--directory", str(tree),
                    "--no-same-owner", "--no-same-permissions"], check=True, timeout=120)
    crossfile = folder / "windows-x64.ini"
    pkgdirs = ":".join(str(p / "install/lib/pkgconfig") for p in stages.values())
    text = (stages["subtitle"] / "windows-x64.ini").read_text()
    text = text.replace(str(stages["subtitle"] / "install/lib/pkgconfig"), pkgdirs)
    crossfile.write_text(text)
    tools = ROOT / "build/native-cross-tools/root/usr"
    env = {**os.environ, "PATH": str(tools / "bin") + os.pathsep + os.environ["PATH"],
           "PYTHONPATH": str(tools / "lib/python3/dist-packages"), "LD_LIBRARY_PATH": str(tools / "lib/x86_64-linux-gnu"),
           "GIT_CEILING_DIRECTORIES": str(folder)}
    command = ["/usr/bin/python3", "-m", "mesonbuild.mesonmain", "setup", str(output), str(tree),
               "--cross-file=" + str(crossfile), "--prefix=" + str(prefix), "--libdir=lib", "--buildtype=release",
               "--default-library=shared", "--wrap-mode=nodownload", "--auto-features=disabled",
               "-Dlibmpv=true", "-Dcplayer=true", "-Dtests=true", "-Dbuild-date=false", "-Dgpl=true",
               "-Dd3d11=enabled", "-Dshaderc=enabled", "-Dspirv-cross=enabled", "-Dwasapi=enabled",
               "-Dd3d-hwaccel=enabled", "-Dd3d9-hwaccel=enabled",
               "-Dwin32-threads=enabled", "-Dlcms2=enabled", "-Dzlib=enabled", "-Dgl=disabled", "-Dlua=disabled"]
    report = {"kind": "self-built-windows-libmpv-sdr-d3d11-candidate-not-admitted", "source": metadata,
              "dependencyStages": {k: str(v.relative_to(ROOT)) for k, v in stages.items()},
              "configureArguments": command, "buildPassed": False, "windowsTestsPassed": False,
              "featureParityVerified": False, "currentRuntimeReplaced": False, "distributionReady": False}
    if replay:
        report["sourceMaterialsReplay"] = {"folder": str(source_root), **replay,
             "dependencyAndToolchainScope": "Explicit rebuilt media/render/subtitle prefixes; compiler/toolchain reused" if args.dependency else "Existing separately validated prefixes reused; not a clean-machine or full dependency rebuild"}
        report["explicitDependencyReplayChain"] = bool(args.dependency)
    (folder / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    shutil.copyfile(ROOT / "build/native-cross-tools/report.json", folder / "compiler-inputs-and-wrappers.json")
    for label, invocation in (("configure", command), ("build", [str(tools / "bin/ninja"), "-C", str(output), "-j4"]),
                              ("install", [str(tools / "bin/ninja"), "-C", str(output), "install"])):
        with (folder / (label + ".log")).open("w") as stream:
            subprocess.run(invocation, env=env, stdout=stream, stderr=subprocess.STDOUT, check=True, timeout=1200)
        print(label + " passed", flush=True)
    # Match the conventional loader filename without altering the compiled DLL.
    dlls = list((prefix / "bin").glob("*mpv*.dll"))
    assert len(dlls) == 1
    if dlls[0].name != "libmpv-2.dll":
        shutil.copyfile(dlls[0], prefix / "bin/libmpv-2.dll")
    for stage in stages.values():
        for binary in json.loads((stage / "report.json").read_text())["binaries"]:
            original = stage / binary["path"]
            assert hashlib.sha256(original.read_bytes()).hexdigest() == binary["sha256"]
            if original.suffix != ".dll":
                continue
            destination = prefix / "bin" / original.name
            if destination.exists():
                assert destination.read_bytes() == original.read_bytes(), "Conflicting dependency DLL"
            else:
                shutil.copyfile(original, destination)
    configuration = (output / "config.h").read_text()
    for feature in ("D3D11", "D3D_HWACCEL", "D3D9_HWACCEL", "WASAPI"):
        assert "#define HAVE_" + feature + " 1" in configuration
    report.update(buildPassed=True, windowsHardwareDecodeCompiled=True, binaries=[{"path": p.relative_to(folder).as_posix(), "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                  for p in sorted((prefix / "bin").glob("*.dll"))])
    (folder / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"folder": str(folder), "buildPassed": True, "distributionReady": False}))
