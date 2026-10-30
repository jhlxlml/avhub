"""Extract pinned Ubuntu cross-build tools into build/, without system install.

This is a host-specific compiler bootstrap, not a complete libmpv build or a
redistributable toolchain. Package digests come from the host's APT metadata;
the resulting lock records that provenance, rather than claiming new signing.
"""
import argparse
import hashlib
import json
from pathlib import Path
import platform
import shutil
import subprocess
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[1]
VERSIONS = {
    "binutils-mingw-w64-x86-64": "2.41.90.20240122-1ubuntu1+11.4",
    "mingw-w64-common": "11.0.1-3build1",
    "mingw-w64-x86-64-dev": "11.0.1-3build1",
    "gcc-mingw-w64-base": "13.2.0-6ubuntu1+26.1",
    "gcc-mingw-w64-x86-64-posix-runtime": "13.2.0-6ubuntu1+26.1",
    "gcc-mingw-w64-x86-64-posix": "13.2.0-6ubuntu1+26.1",
    "g++-mingw-w64-x86-64-posix": "13.2.0-6ubuntu1+26.1",
    "libpkgconf3": "1.8.1-2build1",
    "ninja-build": "1.11.1-2",
    "meson": "1.3.2-1ubuntu1",
    "nasm": "2.16.01-1build1",
    "pkgconf-bin": "1.8.1-2build1",
    "pkgconf": "1.8.1-2build1",
}


def package_metadata(name, version):
    output = subprocess.run(["apt-cache", "show", name + "=" + version],
                            capture_output=True, text=True, check=True, timeout=15).stdout
    fields = dict(line.split(": ", 1) for line in output.split("\n\n")[0].splitlines()
                  if line and not line.startswith(" ") and ": " in line)
    if fields.get("Package") != name or fields.get("Version") != version:
        raise ValueError("Pinned APT metadata does not match: " + name)
    digest = fields["SHA256"]
    if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
        raise ValueError("Invalid package digest")
    return {"package": name, "version": version, "architecture": fields["Architecture"],
            "sha256": digest, "size": int(fields["Size"]), "filename": fields["Filename"],
            "source": fields.get("Source", name), "digestProvenance": "Existing Ubuntu APT index"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true")
    parser.add_argument("--lock", type=Path, help="Use reviewed package metadata without depending on a mutable APT index")
    args = parser.parse_args()
    if platform.system() != "Linux" or platform.machine() != "x86_64":
        raise SystemExit("Run with the existing x86_64 Ubuntu WSL Python")
    folder = ROOT / "build/native-cross-tools"
    cache, extracted = folder / "packages", folder / "root"
    cache.mkdir(parents=True, exist_ok=True)
    extracted.mkdir(exist_ok=True)
    if shutil.disk_usage(folder).free < 2 * 1024**3:
        raise SystemExit("At least 2 GiB free space required")
    records = json.loads(args.lock.read_text(encoding='utf-8'))['packages'] if args.lock else [package_metadata(name, version) for name, version in VERSIONS.items()]
    if [(item['package'], item['version']) for item in records] != list(VERSIONS.items()):
        raise ValueError('Compiler lock must match the fixed toolchain versions')
    # Persist exact input metadata before any network request or extraction.
    lock = {"schema": 1, "target": "Windows x86_64", "host": "Ubuntu 24.04 x86_64",
            "packages": records, "systemPackagesInstalled": False,
            "completeHostClosure": False, "libmpvBuilt": False, "distributionReady": False}
    (folder / "inputs.json").write_text(json.dumps(lock, indent=2) + "\n", encoding="utf8")
    for record in records:
        target = cache / Path(record["filename"]).name
        if not target.exists() and args.download:
            if args.lock:
                filename = record['filename']
                if not filename.startswith('pool/') or '..' in Path(filename).parts:
                    raise ValueError('Invalid official package path')
                with urlopen('https://archive.ubuntu.com/ubuntu/' + filename, timeout=60) as response, target.open('xb') as stream:
                    shutil.copyfileobj(response, stream)
            else:
                subprocess.run(["apt-get", "-o", "Acquire::Retries=0", "-o",
                                "Acquire::http::Timeout=30", "download",
                                record["package"] + "=" + record["version"]],
                               cwd=cache, check=True, timeout=60)
            # APT may URL-encode the epoch in the downloaded basename.
            matches = [p for p in cache.glob(record["package"] + "_*.deb")
                       if p.stat().st_size == record["size"] and
                       hashlib.sha256(p.read_bytes()).hexdigest() == record["sha256"]]
            if not target.exists() and len(matches) == 1:
                matches[0].rename(target)
        if not target.exists() or target.stat().st_size != record["size"] or hashlib.sha256(target.read_bytes()).hexdigest() != record["sha256"]:
            raise ValueError("Missing or mismatched pinned package: " + record["package"])
        # dpkg-deb --extract does not execute maintainer scripts or update dpkg.
        subprocess.run(["dpkg-deb", "--extract", str(target), str(extracted)], check=True, timeout=60)
        print(record["package"] + " verified/extracted", flush=True)
    lock["packagesVerifiedAndExtracted"] = len(records)
    aliases = folder / "bin"
    aliases.mkdir(exist_ok=True)
    mappings = {"gcc": "gcc-posix", "g++": "g++-posix", "ar": "ar", "ranlib": "ranlib",
                "strip": "strip", "nm": "nm", "ld": "ld", "dlltool": "dlltool", "windres": "windres"}
    lock["wrappers"] = []
    for name, executable in mappings.items():
        real = extracted / "usr/bin" / ("x86_64-w64-mingw32-" + executable)
        option = ' --preprocessor="' + str(extracted / "usr/bin/x86_64-w64-mingw32-gcc-posix") + '" --preprocessor-arg=-E --preprocessor-arg=-xc --preprocessor-arg=-DRC_INVOKED' if name == "windres" else ""
        wrapper = aliases / ("x86_64-w64-mingw32-" + name)
        wrapper.write_text('#!/bin/sh\nexec "' + str(real) + '"' + option + ' "$@"\n')
        wrapper.chmod(0o755)
        lock["wrappers"].append({"path": wrapper.relative_to(folder).as_posix(),
                                 "sha256": hashlib.sha256(wrapper.read_bytes()).hexdigest()})
    # pkgconf is a host program; its search path is set by each cross file.
    wrapper = aliases / "x86_64-w64-mingw32-pkg-config"
    wrapper.write_text('#!/bin/sh\nexport LD_LIBRARY_PATH="' + str(extracted / "usr/lib/x86_64-linux-gnu") + '"\nexec "' + str(extracted / "usr/bin/pkgconf") + '" "$@"\n')
    wrapper.chmod(0o755)
    lock["wrappers"].append({"path": wrapper.relative_to(folder).as_posix(),
                             "sha256": hashlib.sha256(wrapper.read_bytes()).hexdigest()})
    (folder / "wrappers.json").write_text(json.dumps(lock["wrappers"], indent=2) + "\n")
    (folder / "report.json").write_text(json.dumps(lock, indent=2) + "\n", encoding="utf8")
    print(json.dumps({"folder": str(folder), "packages": len(records), "libmpvBuilt": False}))
