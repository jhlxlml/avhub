"""Shared boundary for explicit frozen-source dependency replays."""
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def owned_build(selection, marker, pattern, root=ROOT):
    name = selection.name if selection else Path(json.loads((root / "build" / marker).read_text())["folder"]).name
    if not re.fullmatch(pattern, name):
        raise ValueError("Expected an owned native build name")
    folder = root / "build" / name
    if selection and selection.absolute() != folder or folder.is_symlink():
        raise ValueError("Expected a project-owned build directory")
    return folder


def replay_context(materials, recipe, root=ROOT):
    if materials is None:
        return root, None
    folder = materials.absolute()
    if folder.is_symlink() or folder.resolve() != folder or folder.parent != root / "build" or not folder.name.startswith("native-source-materials-"):
        raise ValueError("Expected an owned frozen source-materials directory")
    inventory_file = folder / "inventory.json"
    inventory = json.loads(inventory_file.read_text())
    if inventory["cohort"] != "selfbuilt-sdr-2cf60d001765" or inventory["distributionReady"]:
        raise ValueError("Unexpected frozen source cohort/approval")
    identities = {}
    for item in inventory["files"]:
        file = folder / item["path"]
        if file.is_symlink() or file.resolve() != file or not file.is_relative_to(folder) or not file.is_file() or file.stat().st_size != item["size"]:
            raise ValueError("Invalid frozen source member")
        with file.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if digest != item["sha256"]:
            raise ValueError("Frozen source member changed: " + item["path"])
        identities[item["path"]] = digest
    for file in (Path(recipe), Path(__file__)):
        name = file.relative_to(root).as_posix()
        if identities.get(name) != hashlib.sha256(file.read_bytes()).hexdigest():
            raise ValueError("Re-stage materials to include the actual replay recipe/helper")
    return folder, {"folder": str(folder),
                    "inventorySha256": hashlib.sha256(inventory_file.read_bytes()).hexdigest(),
                    "recipeSha256": identities[Path(recipe).relative_to(root).as_posix()],
                    "scope": "Frozen source inputs and fresh component prefix; existing compiler/toolchain reused"}
