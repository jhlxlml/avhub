"""Build pinned font/subtitle dependencies, with Windows DirectWrite discovery.

Use upstream build systems (including libunibreak's supplied Makefile.gcc),
preserve source archives, and keep all products in a private prefix.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
from native_source_replay import replay_context, owned_build

ROOT = Path(__file__).resolve().parents[1]


def run_step(folder, label, command, env, cwd=None):
    log = folder / (label + ".log")
    if log.exists():
        prior = log.read_bytes()
        (folder / (label + "-previous-" + hashlib.sha256(prior).hexdigest()[:12] + ".log")).write_bytes(prior)
    with log.open("w") as stream:
        subprocess.run(command, cwd=cwd, env=env, stdout=stream, stderr=subprocess.STDOUT, check=True, timeout=900)
    print(label + " passed", flush=True)


if __name__ == "__main__":
    if os.name == "nt":
        raise SystemExit("Use Ubuntu WSL Python")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--resume", type=Path)
    parser.add_argument("--source-materials", type=Path)
    parser.add_argument("--render-deps", type=Path)
    args = parser.parse_args()
    source_root, replay = replay_context(args.source_materials, __file__)
    if replay and (args.resume or not args.render_deps):
        raise ValueError("Use a fresh replay with an explicit cross-configuration template prefix")
    prefix_name = "subtitle-source-replay-" if replay else "subtitle-windows-cross-"
    folder = args.resume.resolve() if args.resume else Path(tempfile.mkdtemp(prefix=prefix_name, dir=ROOT / "build"))
    if folder.parent != (ROOT / "build").resolve() or not folder.name.startswith(prefix_name):
        raise ValueError("Resume is limited to this workspace's owned subtitle builds")
    marker = "subtitle-source-replay-latest.json" if replay else "subtitle-windows-cross-latest.json"
    (ROOT / "build" / marker).write_text(json.dumps({"folder": str(folder)}) + "\n")
    tools = ROOT / "build/native-cross-tools/root/usr"
    cross = str(ROOT / "build/native-cross-tools/bin/x86_64-w64-mingw32-")
    prefix = folder / "install"
    proposal = json.loads((source_root / "ci/native-rebuild-source-proposal.json").read_text())
    source_map = {s["id"]: s for s in proposal["sources"]}
    previous = owned_build(args.render_deps, "render-deps-cross-latest.json", r"render-deps-(?:cross|replay)-[a-z0-9_]+")
    crossfile = folder / "windows-x64.ini"
    cross_text = (previous / "windows-x64.ini").read_text().replace(str(previous / "install"), str(prefix))
    cross_text = cross_text.replace("[properties]", "nasm = '" + str(tools / "bin/nasm") + "'\n[properties]")
    crossfile.write_text(cross_text)
    toolchain = folder / "windows-x64.cmake"
    toolchain.write_text((previous / "windows-x64.cmake").read_text().replace(str(previous / "install"), str(prefix)))
    env = {**os.environ, "PATH": str(tools / "bin") + os.pathsep + os.environ["PATH"],
           "PYTHONPATH": str(tools / "lib/python3/dist-packages"), "LD_LIBRARY_PATH": str(tools / "lib/x86_64-linux-gnu"),
           "PKG_CONFIG_LIBDIR": str(prefix / "lib/pkgconfig"), "GIT_CEILING_DIRECTORIES": str(folder)}
    report = {"kind": "windows-font-subtitle-dependencies-not-electron-acceptance", "components": [],
              "buildPassed": False, "windowsTestsPassed": False, "featureParityVerified": False,
              "currentRuntimeReplaced": False, "distributionReady": False}
    if replay:
        report["sourceMaterialsReplay"] = replay
        report["crossConfigurationTemplate"] = previous.relative_to(ROOT).as_posix()
    if args.resume:
        prior = (folder / "report.json").read_bytes()
        (folder / ("report-before-resume-" + hashlib.sha256(prior).hexdigest()[:12] + ".json")).write_bytes(prior)
        report = json.loads(prior)
        assert not report["buildPassed"], "Use a fresh build to change a completed cohort"
    (folder / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    for name in ("zlib", "brotli", "libpng", "freetype2", "fribidi", "harfbuzz", "libunibreak", "libass"):
        source = source_map[name]
        archive = source_root / "build/native-git-inputs" / (name + "-" + source["revision"][:12] + ".tar")
        metadata = json.loads(archive.with_suffix(".json").read_text())
        assert hashlib.sha256(archive.read_bytes()).hexdigest() == metadata["archiveSha256"]
        completed = next((c for c in report["components"] if c["id"] == name), None)
        if completed:
            assert completed["revision"] == source["revision"] and completed["archiveSha256"] == metadata["archiveSha256"]
            print(name + " reused prior completed build", flush=True)
            continue
        tree, output = folder / (name + "-source"), folder / (name + "-build")
        if not tree.exists():
            tree.mkdir()
            subprocess.run(["tar", "--extract", "--file", str(archive), "--directory", str(tree),
                            "--no-same-owner", "--no-same-permissions"], check=True, timeout=180)
        if name in {"zlib", "brotli", "libpng"}:
            options = {
                "zlib": ["-DZLIB_COMPAT=ON", "-DBUILD_TESTING=OFF", "-DWITH_GTEST=OFF", "-DWITH_NATIVE_INSTRUCTIONS=OFF"],
                "brotli": ["-DBROTLI_DISABLE_TESTS=ON"],
                "libpng": ["-DPNG_SHARED=ON", "-DPNG_STATIC=OFF", "-DPNG_TESTS=OFF", "-DPNG_TOOLS=OFF"],
            }[name]
            configure = ["cmake", "-S", str(tree), "-B", str(output), "-G", "Ninja", "-DCMAKE_TOOLCHAIN_FILE=" + str(toolchain),
                         "-DCMAKE_INSTALL_PREFIX=" + str(prefix), "-DCMAKE_PREFIX_PATH=" + str(prefix),
                         "-DCMAKE_INSTALL_LIBDIR=lib", "-DCMAKE_BUILD_TYPE=Release", "-DBUILD_SHARED_LIBS=ON", *options]
            run_step(folder, name + "-configure", configure, env)
            run_step(folder, name + "-build", ["cmake", "--build", str(output), "--parallel", "4"], env)
            run_step(folder, name + "-install", ["cmake", "--install", str(output)], env)
        elif name == "libunibreak":
            run_step(folder, name + "-build", ["make", "-f", "Makefile.gcc", "CFG=Release", "CC=" + cross + "gcc",
                     "AR=" + cross + "ar", "release", "-j4"], env, tree / "src")
            (prefix / "include").mkdir(parents=True, exist_ok=True)
            (prefix / "lib/pkgconfig").mkdir(parents=True, exist_ok=True)
            shutil.copyfile(tree / "src/ReleaseDir/libunibreak.a", prefix / "lib/libunibreak.a")
            for header in ("unibreakbase.h", "unibreakdef.h", "linebreak.h", "graphemebreak.h", "wordbreak.h"):
                shutil.copyfile(tree / "src" / header, prefix / "include" / header)
            version = re.search(r"AC_INIT\(\[libunibreak\],\[([^]]+)\]", (tree / "configure.ac").read_text()).group(1)
            template = (tree / "libunibreak.pc.in").read_text()
            for key, value in {"prefix": str(prefix), "exec_prefix": "${prefix}", "libdir": "${prefix}/lib",
                               "includedir": "${prefix}/include", "VERSION": version}.items():
                template = template.replace("@" + key + "@", value)
            (prefix / "lib/pkgconfig/libunibreak.pc").write_text(template)
        else:
            options = {
                "freetype2": ["-Dzlib=system", "-Dpng=enabled", "-Dbrotli=enabled", "-Dbzip2=disabled", "-Dharfbuzz=dynamic"],
                "fribidi": ["-Ddocs=false", "-Dbin=false", "-Dtests=false"],
                "harfbuzz": ["-Dfreetype=enabled", "-Dglib=disabled", "-Dgobject=disabled", "-Dcairo=disabled", "-Dicu=disabled",
                             "-Dtests=disabled", "-Ddocs=disabled", "-Dutilities=disabled", "-Dintrospection=disabled",
                             "-Dgpu=disabled", "-Dgpu_demo=disabled", "-Draster=disabled", "-Dvector=disabled", "-Dsubset=disabled"],
                "libass": ["-Dfontconfig=disabled", "-Ddirectwrite=enabled", "-Dasm=enabled", "-Dlibunibreak=enabled",
                           "-Dtest=enabled", "-Dcompare=disabled", "-Dprofile=disabled", "-Dcheckasm=enabled", "-Dlarge-tiles=false"],
            }[name]
            configure = ["/usr/bin/python3", "-m", "mesonbuild.mesonmain", "setup", str(output), str(tree),
                         "--cross-file=" + str(crossfile), "--prefix=" + str(prefix), "--libdir=lib", "--buildtype=release",
                         "--default-library=shared", "--wrap-mode=nodownload", *options]
            run_step(folder, name + "-configure", configure, env)
            run_step(folder, name + "-build", [str(tools / "bin/ninja"), "-C", str(output), "-j4"], env)
            if name == "libass":
                run_step(folder, name + "-checkasm-build", [str(tools / "bin/ninja"), "-C", str(output), "checkasm/checkasm.exe"], env)
            run_step(folder, name + "-install", [str(tools / "bin/ninja"), "-C", str(output), "install"], env)
        report["components"].append({"id": name, "revision": source["revision"], "archiveSha256": metadata["archiveSha256"], "buildPassed": True})
        (folder / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    for name in ("libssp-0.dll", "libgcc_s_seh-1.dll", "libstdc++-6.dll"):
        shutil.copyfile(tools / "lib/gcc/x86_64-w64-mingw32/13-posix" / name, prefix / "bin" / name)
    shutil.copyfile(tools / "x86_64-w64-mingw32/lib/libwinpthread-1.dll", prefix / "bin/libwinpthread-1.dll")
    report.update(buildPassed=True, binaries=[{"path": p.relative_to(folder).as_posix(), "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                  for p in sorted((prefix / "bin").glob("*.dll"))])
    (folder / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"folder": str(folder), "buildPassed": True}))
