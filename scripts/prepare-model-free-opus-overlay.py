"""Prepare local recipe overrides; never edit the upstream cache or build a DLL."""
import hashlib
import json
from pathlib import Path
import re
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TOOLCHAIN_COMMIT = "1f8d2e76255abc48f0456d9be99b4cab9c6566e6"
ARCHIVE_SHA = "5933a6e0bb035c6472d820d61344a60ab21d2ac6bc5355b00417f58df91b33dd"


def model_free_files(opus, index, profile):
    settings = profile["opus"]
    if set(settings["modelFeatures"]) != {"deep-plc", "dred", "osce"} or any(v != "disabled" for v in settings["modelFeatures"].values()) or not re.fullmatch(r"[a-f0-9]{40}", settings["revision"]):
        raise ValueError("Model-free override requires all model features disabled at a fixed revision")
    # Both the dependency and aggregate download list must change; dropping only
    # the source proposal would still trigger the old global download target.
    opus = re.sub(r"^.*src_opus_dnn.*\n", "", opus, flags=re.M)
    opus = opus.replace("    DEPENDS\n        opus-dnn\n", "")
    opus = opus.replace("    GIT_REMOTE_NAME origin\n", "")
    opus = opus.replace("    GIT_TAG main\n", "    GIT_TAG " + settings["revision"] + "\n")
    options = ["-D" + name + "=" + value for name, value in settings["modelFeatures"].items()] + settings["mesonAdditionalOptions"]
    opus = opus.replace("        -Dhardening=false\n", "".join("        " + option + "\n" for option in options) + "        -Dhardening=false\n")
    index = index.replace("    opus-dnn\n", "")
    if "opus-dnn" in opus or "src_opus_dnn" in opus or "opus-dnn" in index or not all(option in opus for option in options):
        raise ValueError("Fixed recipe could not be transformed completely")
    return {"packages/opus.cmake": opus, "packages/CMakeLists.txt": index}


if __name__ == "__main__":
    archive = ROOT / ("build/m5-source-inputs/toolchain-" + TOOLCHAIN_COMMIT + ".zip")
    if hashlib.sha256(archive.read_bytes()).hexdigest() != ARCHIVE_SHA:
        raise ValueError("Toolchain source archive differs")
    with zipfile.ZipFile(archive) as source:
        prefix = "mpv-winbuild-cmake-" + TOOLCHAIN_COMMIT + "/"
        opus = source.read(prefix + "packages/opus.cmake").decode("utf8")
        index = source.read(prefix + "packages/CMakeLists.txt").decode("utf8")
    profile = json.loads((ROOT / "ci/native-rebuild-profile.json").read_text(encoding="utf8"))
    files = model_free_files(opus, index, profile)
    folder = Path(tempfile.mkdtemp(prefix="native-opus-overlay-", dir=ROOT / "build"))
    inventory = []
    for name, text in files.items():
        file = folder / name
        file.parent.mkdir(parents=True, exist_ok=True)
        data = text.encode("utf8")
        file.write_bytes(data)
        inventory.append({"path": name, "sha256": hashlib.sha256(data).hexdigest()})
    record = {"folder": str(folder), "sourceToolchainCommit": TOOLCHAIN_COMMIT, "profile": profile, "files": inventory, "scope": "Local derived recipe overrides; full upstream cross-build not performed", "buildVerified": False, "distributionReady": False}
    (folder / "overlay.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf8")
    (ROOT / "build/native-opus-overlay.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf8")
    print(json.dumps({"folder": str(folder), "files": len(files), "buildVerified": False}))
