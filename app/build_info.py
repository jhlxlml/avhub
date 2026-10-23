"""Captured at service startup so a running old backend cannot claim a new build."""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent.parent))
PROTOCOL = 2
try:
    BUILD = json.loads((ROOT / 'app' / 'build-info.json').read_text(encoding='utf-8'))
except (OSError, ValueError):
    BUILD = {'version': '0.2.16', 'build_id': 'unbuilt', 'built_at': None}
if not getattr(sys, 'frozen', False):
    files = ['run.py', 'package.json', 'package-lock.json', 'requirements.txt', 'vite.config.ts', 'app/sqlite-runtime.json']
    for directory in ['app', 'frontend/src', 'electron/src']:
        candidates = (ROOT / directory).iterdir() if directory == 'app' else (ROOT / directory).rglob('*')
        files += [item.relative_to(ROOT).as_posix() for item in candidates
                  if item.is_file() and item.suffix in {'.py', '.ts', '.tsx', '.css'}]
    files += [item.relative_to(ROOT).as_posix() for item in (ROOT/'frontend/public').rglob('*') if item.is_file()]
    digest = hashlib.sha256()
    for name in sorted(files):
        digest.update((name + '\0').encode()); digest.update((ROOT / name).read_bytes())
    BUILD = {**BUILD, 'build_id': digest.hexdigest()[:16]}
BUILD = {**BUILD, 'api_protocol': PROTOCOL}
