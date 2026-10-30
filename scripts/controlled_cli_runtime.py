"""Validate the source-built CI payload once, then install only matching CLI inputs."""
import hashlib
import json
import shutil
from pathlib import Path


def prepare(root: Path, directory: Path, destination: Path):
    profile = root / 'ci/controlled-ffmpeg.json'
    index_file = directory / 'runtime-index.json'
    index = json.loads(index_file.read_text(encoding='utf-8'))
    expected = {'ffmpeg.exe', 'ffprobe.exe', 'FFmpeg-LICENSE.txt', 'FFmpeg-BUILD-INFO.txt', 'FFmpeg-THIRD-PARTY-NOTICES.txt'}
    if (index['schema'] != 1 or index['kind'] != 'avhub-controlled-ffmpeg-runtime'
        or index['sourceProfileSha256'] != hashlib.sha256(profile.read_bytes()).hexdigest()
        or index['buildRecipeSha256'] != hashlib.sha256((root / 'scripts/build-controlled-ffmpeg.py').read_bytes()).hexdigest()
        or index['crossToolsSha256'] != hashlib.sha256((root / 'ci/controlled-cli-cross-tools.json').read_bytes()).hexdigest()
        or {item['path'] for item in index['files']} != expected or len(index['files']) != len(expected)):
        raise ValueError('Controlled CLI source, recipe, toolchain or member identity differs')
    for item in index['files']:
        source = directory / item['path']
        if source.is_symlink() or not source.is_file() or source.stat().st_size != item['size'] or hashlib.sha256(source.read_bytes()).hexdigest() != item['sha256']:
            raise ValueError('Controlled CLI artifact differs: ' + item['path'])
        target = destination / item['path']
        if target.exists():
            if target.is_symlink() or hashlib.sha256(target.read_bytes()).hexdigest() != item['sha256']:
                raise ValueError('Existing CLI differs; preserve it explicitly before adopting: ' + str(target))
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            with source.open('rb') as original, target.open('xb') as output:
                shutil.copyfileobj(original, output)
    target = destination / 'FFmpeg-RUNTIME.json'
    if target.exists() and (target.is_symlink() or target.read_bytes() != index_file.read_bytes()):
        raise ValueError('Existing CLI provenance differs; refusing to overwrite')
    if not target.exists():
        target.write_bytes(index_file.read_bytes())
    return index['version']
