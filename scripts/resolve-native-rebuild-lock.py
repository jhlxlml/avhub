"""Resolve a NEW candidate's public source refs; never rewrite the old DLL's history."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]


def rebuild_inputs(materials, profile):
    opus = profile["opus"]
    features = opus["modelFeatures"]
    if profile["schema"] != 1 or set(features) != {"deep-plc", "dred", "osce"} or not all(v in {"enabled", "disabled"} for v in features.values()) or not re.fullmatch(r"[a-f0-9]{40}", opus["revision"]):
        raise ValueError("Invalid explicit Opus build profile")
    model_free = all(value == "disabled" for value in features.values())
    components = [c for c in materials["components"] if not (model_free and c["id"] == "opus-dnn")]
    fixed = {"mpv": materials["subject"]["mpvSourceCommit"], "ffmpeg": materials["subject"]["ffmpegResolvedCommit"], "opus": opus["revision"]}
    excluded = [{"id": "opus-dnn", "reason": "All three optional model features explicitly disabled at the reviewed Opus revision; remove unconditional model copy/download, retain standard codec"}] if model_free else []
    return components, fixed, excluded


def advertised_revision(text, requested):
    refs = {}
    for line in text.splitlines():
        fields = line.split("\t")
        if len(fields) == 2 and re.fullmatch(r"[a-f0-9]{40}", fields[0]):
            refs[fields[1]] = fields[0]
    candidates = ["HEAD"] if requested == "HEAD" else ["refs/heads/" + requested, "refs/tags/" + requested + "^{}", "refs/tags/" + requested]
    if requested != "HEAD" and candidates[0] in refs and any(name in refs for name in candidates[1:]):
        raise ValueError("Branch/tag name is ambiguous; choose an explicit source policy")
    return next((refs[name] for name in candidates if name in refs), None)


def resolve(component, fixed):
    fields = component["recipeFields"]
    base = {"id": component["id"], "recipeSha256": component["recipeSha256"]}
    if "GIT_REPOSITORY" not in fields:
        return {**base, "url": fields.get("URL"), "declaredHash": fields.get("URL_HASH"), "state": "archive-hash-declared-not-downloaded", "sourceVerified": False}
    repo = fields["GIT_REPOSITORY"].strip('"')
    parsed = urlsplit(repo)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        return {**base, "state": "unsupported-public-repository-reference", "sourceVerified": False}
    if component["id"] in fixed:
        return {**base, "repository": repo, "revision": fixed[component["id"]], "state": "fixed-from-verified-project-source", "sourceVerified": False}
    requested = fields.get("GIT_TAG", "HEAD").strip('"')
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]*", requested) or ".." in requested:
        return {**base, "repository": repo, "state": "unresolved-recipe-expression", "sourceVerified": False}
    patterns = ["HEAD"] if requested == "HEAD" else ["refs/heads/" + requested, "refs/tags/" + requested, "refs/tags/" + requested + "^{}"]
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GCM_INTERACTIVE": "Never"}
    result = subprocess.run(["git", "-c", "credential.helper=", "ls-remote", "--symref", repo, *patterns], capture_output=True, text=True, encoding="utf8", errors="replace", timeout=25, env=env)
    revision = advertised_revision(result.stdout, requested) if result.returncode == 0 else None
    return {**base, "repository": repo, "requestedRef": requested, "revision": revision, "state": "advertised-revision-resolved" if revision else "remote-reference-unresolved", "sourceVerified": False, **({"error": result.stderr[-1200:]} if result.returncode else {})}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--resolve", action="store_true", required=True, help="Explicitly allow read-only public Git ref queries")
    parser.parse_args()
    materials = json.loads((ROOT / "third_party/libmpv-render-d3d11/materials.json").read_text(encoding="utf8"))
    profile = json.loads((ROOT / "ci/native-rebuild-profile.json").read_text(encoding="utf8"))
    components, fixed, excluded = rebuild_inputs(materials, profile)
    def attempt(component):
        try:
            return resolve(component, fixed)
        except (subprocess.TimeoutExpired, ValueError) as error:
            return {"id": component["id"], "state": "remote-reference-unresolved", "sourceVerified": False, "error": str(error)}
    with ThreadPoolExecutor(max_workers=4) as executor:
        sources = list(executor.map(attempt, components))
    report = {"schema": 1, "scope": "New rebuild candidate planning only; current advertised refs are NOT historical binary revisions", "existingDllUnchanged": True, "conditionalSourceExpressions": materials["unresolvedRecipeExpressions"], "buildProfile": profile, "excludedSourceInputs": excluded, "sources": sources, "buildVerified": False, "distributionReady": False}
    output = ROOT / "build/native-rebuild-lock-draft.json"
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf8")
    print(json.dumps({"report": str(output), "sources": len(sources), "revisions": sum(bool(s.get("revision")) for s in sources), "unresolved": [s["id"] for s in sources if s["state"] == "remote-reference-unresolved"], "buildVerified": False}))
