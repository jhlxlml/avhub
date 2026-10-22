"""Fail packaging if dependency analysis collected a host DLL instead of our pin."""
import json
from pathlib import Path
import sys
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from app.sqlite_runtime import manifest,validate_binary


def verify(folder):
    info=manifest();internal=folder/'_internal'
    actual=json.loads((internal/'app/sqlite-runtime.json').read_text(encoding='utf-8'))
    if actual!=info:raise RuntimeError('Bundled SQLite manifest differs from source')
    libraries=list(folder.rglob('sqlite3.dll'))
    if len(libraries)!=1 or libraries[0]!=internal/'sqlite3.dll':raise RuntimeError('Expected exactly one private SQLite DLL')
    validate_binary(libraries[0],info)
    return info['version']


if __name__=='__main__':print('Bundled SQLite verified:',verify(ROOT/'build/backend-dist/AVHubServer'))
