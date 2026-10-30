"""Prepare matching CLI binaries/notices for the ordinary desktop build."""
import json
from pathlib import Path
import tempfile
from controlled_cli_runtime import prepare

ROOT=Path(__file__).resolve().parents[1]
selected=Path(json.loads((ROOT/'build/controlled-cli-runtime-latest.json').read_text(encoding='utf-8'))['folder'])
if selected.is_symlink() or not selected.resolve().is_relative_to((ROOT/'build').resolve()):
    raise ValueError('Owned controlled CLI runtime required')
folder=Path(tempfile.mkdtemp(prefix='desktop-cli-inputs-',dir=ROOT/'build'))
prepare(ROOT,selected,folder)
(ROOT/'build/desktop-cli-inputs.json').write_text(json.dumps({'folder':str(folder)})+'\n',encoding='utf-8')
print(json.dumps({'folder':str(folder)}))
