"""Prepare a pinned app-local loader; never install or modify Windows files."""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import struct
import tempfile
from urllib.request import urlopen
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def prepare(root=ROOT, offline=False):
    root = root.resolve()
    manifest = json.loads((root / "ci/vulkan-runtime.json").read_text(encoding="utf8"))
    if manifest["schema"] != 1 or manifest["platform"] != "windows-x64" or not re.fullmatch(r"1\.4\.\d+\.0", manifest["version"]) or manifest["archiveUrl"] != f"https://sdk.lunarg.com/sdk/download/{manifest['version']}/windows/VulkanRT-X64-{manifest['version']}-Components.zip":
        raise ValueError("Unexpected fixed Vulkan input")
    license_text = (root / "third_party/vulkan-loader/LICENSE.txt").read_bytes()
    if digest(license_text) != manifest["licenseSha256"]:
        raise ValueError("Vulkan source license differs")
    folder = root / "build/vulkan-runtime-input"
    # Same owned-cache rule as the existing pinned runtime preparers.
    for candidate in [root / "build", folder, folder / "runtime"]:
        if candidate.is_symlink() or candidate.is_junction():
            raise ValueError("Redirected Vulkan preparation path")
    folder.mkdir(parents=True, exist_ok=True)
    archive = folder / manifest["archiveUrl"].rsplit("/", 1)[1]
    if archive.is_symlink():
        raise ValueError("Redirected Vulkan archive")
    if not archive.exists():
        if offline:
            raise FileNotFoundError("Pinned official Runtime ZIP missing; offline mode never downloads")
        fd, temporary = tempfile.mkstemp(prefix="download-", suffix=".part", dir=folder)
        try:
            with os.fdopen(fd, "wb") as output, urlopen(manifest["archiveUrl"], timeout=30) as response:
                total = 0
                while chunk := response.read(1024**2):
                    total += len(chunk)
                    if total > manifest["archiveSize"]:
                        raise ValueError("Vulkan archive exceeds pinned size")
                    output.write(chunk)
            raw = Path(temporary).read_bytes()
            if len(raw) != manifest["archiveSize"] or digest(raw) != manifest["archiveSha256"]:
                raise ValueError("Official Vulkan archive identity mismatch")
            os.link(temporary, archive)
        finally:
            Path(temporary).unlink(missing_ok=True)
    if archive.stat().st_size != manifest["archiveSize"] or digest(archive.read_bytes()) != manifest["archiveSha256"]:
        raise ValueError("Existing Vulkan archive differs; preserved")
    # Select the actual AMD64 DLL by its PE header, not an assumed ZIP layout.
    # Archive identity is pinned before inspecting any member; no extractall.
    matches = []
    with zipfile.ZipFile(archive) as source:
        runtime_license = source.read(manifest["archiveLicenseName"])
        if digest(runtime_license) != manifest["archiveLicenseSha256"]:
            raise ValueError("Vulkan runtime license differs")
        for member in source.infolist():
            if member.filename.replace("\\", "/").rsplit("/", 1)[-1].lower() != "vulkan-1.dll":
                continue
            if not 64 <= member.file_size <= 8 * 1024**2:
                raise ValueError("Unexpected Vulkan DLL size")
            data = source.read(member)
            pe = struct.unpack_from("<I", data, 0x3C)[0]
            if data[:2] != b"MZ" or pe + 26 > len(data) or data[pe:pe + 4] != b"PE\0\0":
                raise ValueError("Invalid Vulkan PE image")
            if struct.unpack_from("<H", data, pe + 4)[0] == 0x8664 and struct.unpack_from("<H", data, pe + 24)[0] == 0x20B:
                matches.append((member.filename, data))
    if len(matches) != 1:
        raise ValueError("Expected exactly one AMD64 Vulkan loader")
    member, binary = matches[0]
    runtime = folder / "runtime"
    runtime.mkdir(exist_ok=True)
    record = {"schema": 1, "platform": "windows-x64", "version": manifest["version"], "archiveSha256": manifest["archiveSha256"], "sourceCommit": manifest["sourceCommit"], "archiveMember": member, "files": [{"name": "vulkan-1.dll", "size": len(binary), "sha256": digest(binary)}, {"name": "LICENSE.txt", "size": len(license_text), "sha256": digest(license_text)}, {"name": "VulkanRT-License.txt", "size": len(runtime_license), "sha256": digest(runtime_license)}], "distributionReady": False}
    for name, data in [("vulkan-1.dll", binary), ("LICENSE.txt", license_text), ("VulkanRT-License.txt", runtime_license), ("runtime.json", (json.dumps(record, indent=2) + "\n").encode())]:
        output = runtime / name
        if output.is_symlink() or output.is_junction():
            raise ValueError("Redirected Vulkan runtime member")
        if output.exists():
            if output.read_bytes() != data:
                raise ValueError("Existing Vulkan runtime differs; preserved")
        else:
            with output.open("xb") as stream:
                stream.write(data)
    return record


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    print(json.dumps(prepare(offline=args.offline), indent=2))
