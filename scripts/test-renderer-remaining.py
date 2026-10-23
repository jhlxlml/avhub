"""Run all renderer specs not explicitly listed by the Windows workflow.

Component/decoder harnesses only; never substitute these for Electron acceptance.
"""
from pathlib import Path
import re
import shutil
import subprocess
import sys
import yaml

ROOT=Path(__file__).resolve().parents[1]


def remaining(workflow,root=ROOT):
    commands='\n'.join(step.get('run','') for step in workflow['jobs']['verify']['steps'])
    listed=set(re.findall(r'tests/ui/[\w/-]+\.spec\.ts',commands))
    return sorted(path.relative_to(root).as_posix() for path in (root/'tests/ui').rglob('*.spec.ts')
                  if path.relative_to(root).as_posix() not in listed)


def main():
    workflow=yaml.load((ROOT/'.github/workflows/windows.yml').read_text(encoding='utf-8'),Loader=yaml.BaseLoader)
    files=remaining(workflow)
    print('Remaining renderer harness files:',len(files),*files,sep='\n',flush=True)
    if '--list' in sys.argv or not files:return
    npx=shutil.which('npx')
    if not npx:raise SystemExit('npx is required')
    subprocess.run([npx,'playwright','test',*files],cwd=ROOT,check=True)


if __name__=='__main__':main()
