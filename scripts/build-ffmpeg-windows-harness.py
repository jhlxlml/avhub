"""Build a fixed Windows FFmpeg baseline; not an admitted libmpv replacement.

External optional codecs/filters are not yet linked. Save the exact component
lists so this baseline cannot be mistaken for feature parity with the old DLL.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tempfile
from native_source_replay import replay_context, owned_build

ROOT = Path(__file__).resolve().parents[1]


if __name__ == "__main__":
    if platform.system() != "Linux":
        raise SystemExit("Run with Ubuntu WSL Python")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dav1d", action="store_true")
    parser.add_argument("--zlib", action="store_true")
    parser.add_argument("--source-materials", type=Path)
    parser.add_argument("--dav1d-prefix", type=Path)
    parser.add_argument("--subtitle-prefix", type=Path)
    args = parser.parse_args()
    source_root, replay = replay_context(args.source_materials, __file__)
    if replay and not (args.dav1d and args.zlib and args.dav1d_prefix and args.subtitle_prefix):
        raise ValueError("Replay must retain dav1d/zlib and select their fresh prefixes explicitly")
    proposal = json.loads((source_root / "ci/native-rebuild-source-proposal.json").read_text())
    source = next(s for s in proposal["sources"] if s["id"] == "ffmpeg")
    base = source_root / "build/native-git-inputs"
    archive = base / ("ffmpeg-" + source["revision"][:12] + ".tar")
    source_record = json.loads(archive.with_suffix(".json").read_text())
    if hashlib.sha256(archive.read_bytes()).hexdigest() != source_record["archiveSha256"]:
        raise ValueError("Pinned FFmpeg archive changed")
    folder = Path(tempfile.mkdtemp(prefix="ffmpeg-source-replay-" if replay else "ffmpeg-windows-cross-", dir=ROOT / "build"))
    tree, output, prefix = folder / "source", folder / "build", folder / "install"
    tree.mkdir(); output.mkdir()
    subprocess.run(["tar", "--extract", "--file", str(archive), "--directory", str(tree),
                    "--no-same-owner", "--no-same-permissions"], check=True, timeout=180)
    shutil.copyfile(ROOT / "build/native-cross-tools/inputs.json", folder / "compiler-inputs.json")
    shutil.copyfile(ROOT / "build/native-cross-tools/wrappers.json", folder / "compiler-wrappers.json")
    tools = ROOT / "build/native-cross-tools/root/usr"
    env = {**os.environ, "PATH": str(tools / "bin") + os.pathsep + os.environ["PATH"],
           "LD_LIBRARY_PATH": str(tools / "lib/x86_64-linux-gnu"), "GIT_CEILING_DIRECTORIES": str(folder)}
    cross = str(ROOT / "build/native-cross-tools/bin/x86_64-w64-mingw32-")
    command = [str(tree / "configure"), "--prefix=" + str(prefix), "--target-os=mingw32",
               "--arch=x86_64", "--enable-cross-compile", "--cross-prefix=" + cross,
               "--cc=" + cross + "gcc", "--cxx=" + cross + "g++",
               "--pkg-config=" + cross + "pkg-config",
               "--enable-shared", "--disable-static", "--disable-debug", "--disable-doc",
               "--disable-ffplay", "--disable-autodetect", "--enable-gpl", "--enable-version3",
               "--enable-d3d11va", "--enable-dxva2"]
    report = {"kind": "fixed-windows-ffmpeg-built-in-codec-baseline-not-feature-parity",
              "sourceRevision": source["revision"], "sourceArchiveSha256": source_record["archiveSha256"],
              "configureArguments": command[1:], "buildPassed": False, "windowsExecutionPassed": False,
              "featureParityVerified": False, "currentRuntimeReplaced": False, "distributionReady": False}
    if replay:
        report["sourceMaterialsReplay"] = replay
    if args.dav1d:
        dependency = owned_build(args.dav1d_prefix, "dav1d-windows-cross-latest.json", r"dav1d-(?:windows-cross|source-replay)-[a-z0-9_]+")
        dependency_report = json.loads((dependency / "report.json").read_text())
        assert dependency_report["buildPassed"]
        if replay:
            assert dependency_report["sourceMaterialsReplay"]["inventorySha256"] == replay["inventorySha256"]
        command.append("--enable-libdav1d")
        env["PKG_CONFIG_LIBDIR"] = str(dependency / "install/lib/pkgconfig")
        report["dav1dDependency"] = str(dependency.relative_to(ROOT))
    if args.zlib:
        subtitle = owned_build(args.subtitle_prefix, "subtitle-windows-cross-latest.json", r"subtitle-(?:windows-cross|source-replay)-[a-z0-9_]+")
        subtitle_report = json.loads((subtitle / "report.json").read_text())
        assert subtitle_report["buildPassed"]
        if replay:
            assert subtitle_report["sourceMaterialsReplay"]["inventorySha256"] == replay["inventorySha256"]
            assert subtitle_report["windowsTestsPassed"]
        command.append("--enable-zlib")
        env["PKG_CONFIG_LIBDIR"] = ":".join(filter(None, [env.get("PKG_CONFIG_LIBDIR"), str(subtitle / "install/lib/pkgconfig")]))
        report["zlibDependency"] = str(subtitle.relative_to(ROOT))
    marker = "ffmpeg-source-replay-latest.json" if replay else "ffmpeg-windows-cross-latest.json"
    (ROOT / "build" / marker).write_text(json.dumps({"folder": str(folder)}) + "\n")
    (folder / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    revision = "git-" + source["revision"][:12]
    report["explicitVersionRevision"] = revision
    (folder / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    for label, invocation in (("configure", command),
                              ("version-metadata", ["env", "revision=" + revision, str(tree / "ffbuild/version.sh"), str(tree), "libavutil/ffversion.h"]),
                              ("build", ["make", "-j8", "REVISION=" + revision]),
                              ("install", ["make", "install", "REVISION=" + revision])):
        with (folder / (label + ".log")).open("w") as stream:
            subprocess.run(invocation, cwd=output, env=env, stdout=stream,
                           stderr=subprocess.STDOUT, check=True, timeout=1200)
        print(label + " passed", flush=True)
    for name in ("libssp-0.dll", "libgcc_s_seh-1.dll"):
        shutil.copyfile(tools / "lib/gcc/x86_64-w64-mingw32/13-posix" / name, prefix / "bin" / name)
    shutil.copyfile(tools / "x86_64-w64-mingw32/lib/libwinpthread-1.dll", prefix / "bin/libwinpthread-1.dll")
    if args.dav1d:
        for binary in dependency_report["binaries"]:
            original = dependency / binary["path"]
            assert hashlib.sha256(original.read_bytes()).hexdigest() == binary["sha256"]
            shutil.copyfile(original, prefix / "bin" / original.name)
    if args.zlib:
        for binary in subtitle_report["binaries"]:
            original = subtitle / binary["path"]
            if original.name.lower().startswith("zlib"):
                assert hashlib.sha256(original.read_bytes()).hexdigest() == binary["sha256"]
                shutil.copyfile(original, prefix / "bin" / original.name)
    report.update(buildPassed=True, compilerInputsSha256=hashlib.sha256((folder / "compiler-inputs.json").read_bytes()).hexdigest(),
                  compilerWrappersSha256=hashlib.sha256((folder / "compiler-wrappers.json").read_bytes()).hexdigest(),
                  configurationSha256=hashlib.sha256((output / "config.h").read_bytes()).hexdigest(),
                  componentsSha256=hashlib.sha256((output / "config_components.h").read_bytes()).hexdigest(),
                  binaries=[{"path": p.relative_to(folder).as_posix(), "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                            for p in sorted((prefix / "bin").glob("*")) if p.suffix in (".dll", ".exe")])
    (folder / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"folder": str(folder), "buildPassed": True, "featureParityVerified": False}))
