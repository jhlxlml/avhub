"""Collect native source inputs/recipes/notices into an owned review directory.

No application binaries, media, database, Git config, or packaging/publication.
This is a review dossier, not proof of reproducible builds/license compliance.
"""
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import argparse

ROOT = Path(__file__).resolve().parents[1]


def stage(root=ROOT,*,replayed=False,audit_only=False):
    build = root / "build"
    layout = json.loads((build / ("replayed-render-staging.json" if replayed else "selfbuilt-render-staging.json")).read_text())
    candidate = Path(layout["folder"])
    materials = json.loads((candidate / "materials.json").read_text())
    support = json.loads((build / "native-support-source-inputs/report.json").read_text())
    if not support["allInputsVerified"] or materials["distributionReady"]:
        raise ValueError("Source inventory incomplete or incorrectly approved")
    inputs = {}

    def add(file, expected=None):
        file = file.absolute()
        relative = file.relative_to(root)
        if file.is_symlink() or not file.is_file() or file.resolve() != file or file.stat().st_size > 512 * 1024**2:
            raise ValueError("Expected one owned regular source/material input")
        with file.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if expected is not None and digest != expected:
            raise ValueError("Source/material identity changed: " + str(relative))
        inputs[relative.as_posix()] = {"sha256": digest, "size": file.stat().st_size}

    for source in materials["sourceArchives"]:
        archive = root / source["archive"]
        add(archive, source["archiveSha256"])
        add(archive.with_suffix(".json"))
    # Compatibility inputs are additional to the historical dependency builds.
    # Preserve the staged historical receipt, including its original test status.
    for item in materials['subject'].get('patches', []):
        add(root / item['path'], item['sha256'])
    if 'compatibilityBuild' in materials:
        compatibility = candidate / 'materials/compatibility'
        for name in ('mkv-reversed-cues.patch', 'build.json', 'build-mkv-index-candidate.py'):
            add(compatibility / name)
    for source in support["sources"]:
        for item in source["files"]:
            file = root / item["path"]
            if file.stat().st_size != item["size"]:
                raise ValueError("Support source size changed")
            add(file, item["sha256"])
    add(build / "native-support-source-inputs/report.json")
    add(build / "native-support-materials/report.json")
    add(build / "native-cross-tools/inputs.json")
    for file in (build / "native-cross-tools/bin").iterdir():
        if not file.name.startswith("x86_64-w64-mingw32-"):
            raise ValueError("Unknown compiler wrapper")
        add(file)
    add(root / "LICENSE")
    for file in (root / "scripts").iterdir():
        if file.name == "native_source_replay.py" or file.suffix in {".py", ".mjs"} and any(file.name.startswith(prefix) for prefix in
                ["build-", "verify-", "prepare-native-", "prepare-model-free-", "probe-native-",
                 "audit-libmpv-", "capture-native-", "stage-native-source-", "prepare-native-support-"]):
            add(file)
    for file in (root / "ci").glob("*.json"):
        add(file)
    for name in ["test_native_support_sources.py", "test_native_support_materials.py", "test_native_source_materials.py", "test_native_source_replay.py", "test_native_dependency_replay.py", "test_native_media_replay.py"]:
        add(root / "tests" / name)
    for file in (root / "electron/native/render").glob("*.cs"):
        add(file)
    for record in materials["buildRecords"]:
        folder = (root / record).parent
        for file in folder.iterdir():
            if file.is_file() and (file.suffix in {".log", ".ini", ".cmake"} or file.name in
                    {"report.json", "windows-tests.json", "import-audit.json", "compiler-inputs-and-wrappers.json"}):
                add(file)
    for file in layout["files"]:
        if file["path"].startswith("materials/"):
            add(candidate / file["path"], file["sha256"])
    add(candidate / "materials.json")
    add(candidate / "layout.json")
    add(candidate / "runtime.json")
    total = sum(file["size"] for file in inputs.values())
    if total > 2 * 1024**3 or not audit_only and shutil.disk_usage(build).free < total + 256 * 1024**2:
        raise OSError("Source review dossier exceeds space/capacity limit")
    if audit_only:
        return {'schema':1, 'scope':'read-only-native-source-inventory-not-distribution',
                'candidate':str(candidate), 'cohort':materials['subject']['id'],
                'gitSourceArchives':len(materials['sourceArchives']), 'supportSourcePackages':len(support['sources']),
                'files':[{'path':name, **item} for name,item in sorted(inputs.items())],
                'totalBytes':total, 'distributionReady':False, 'copiedBytes':0}
    destination = Path(tempfile.mkdtemp(prefix="native-replayed-source-materials-" if replayed else "native-source-materials-", dir=build))
    for name, item in sorted(inputs.items()):
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        with (root / name).open("rb") as source, target.open("xb") as output:
            shutil.copyfileobj(source, output, 1024**2)
        with target.open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != item["sha256"]:
                raise ValueError("Source changed while copying")
    report = {"schema": 1, "folder": str(destination), "cohort": materials["subject"]["id"],
              "candidate": str(candidate),
              "scope": "Native source review dossier only; not full application corresponding source or build environment",
              "gitSourceArchives": len(materials["sourceArchives"]), "supportSourcePackages": len(support["sources"]),
              "files": [{"path": name, **item} for name, item in sorted(inputs.items())],
              "totalBytes": total, "runtimeRebuiltFromDossier": False, "dscSignaturesVerified": False,
              "distributionReady": False,
              "remaining": ["Corresponding-source/build recipe review including toolchain package patches",
                            "Full application source snapshot at authorized release revision",
                            "Clean-machine/packaged acceptance and retained resource observations"]}
    (destination / "inventory.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
    (destination / "README.txt").write_text(
        "Native source materials for " + materials["subject"]["id"] + "\n"
        "Original project-relative paths are retained. No application runtime binaries, user media or database were collected.\n"
        "Start with inventory.json, ci/native-support-sources.json and the actual build reports.\n"
        "Build order: render dependencies; shaderc; libplacebo; dav1d; subtitle chain; FFmpeg; libmpv; native host.\n"
        "Recipes require the documented Windows/Ubuntu WSL toolchain and generated staging prefixes.\n"
        "No clean environment replay or byte-reproducibility is claimed. DSC signatures are not verified.\n"
        "GCC/MinGW archives contain distro patches; do not replace them with a newer upstream release.\n"
        "The full AVHub source revision and dependency/license review remain required before distribution.\n",
        encoding="utf8")
    (build / ("native-replayed-source-materials-latest.json" if replayed else "native-source-materials-latest.json")).write_text(json.dumps({
        "folder": str(destination), "files": len(inputs), "totalBytes": total,
        "distributionReady": False}, indent=2) + "\n", encoding="utf8")
    return report


if __name__ == "__main__":
    parser=argparse.ArgumentParser();parser.add_argument('--replayed',action='store_true');parser.add_argument('--audit-only',action='store_true')
    args=parser.parse_args();report = stage(replayed=args.replayed,audit_only=args.audit_only)
    print(json.dumps(report if args.audit_only else {key: report[key] for key in ["folder", "gitSourceArchives", "supportSourcePackages", "totalBytes", "distributionReady"]}))
