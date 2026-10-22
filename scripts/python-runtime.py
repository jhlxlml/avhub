"""Run project diagnostics/tests with the SAME SQLite as Electron, before any imports."""
from pathlib import Path
import runpy
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.sqlite_runtime import initialize


def main():
    initialize()
    args=sys.argv[1:]
    if args[:1]==['--check']:
        import json
        print(json.dumps(initialize()));return
    if len(args)>=2 and args[0]=='-m':
        sys.argv=args[1:];runpy.run_module(args[1],run_name='__main__',alter_sys=True)
    elif args and not args[0].startswith('-'):
        script=Path(args[0]).resolve()
        if not script.is_relative_to(Path(__file__).resolve().parents[1]):raise SystemExit('Project scripts only')
        sys.argv=args;sys.path.insert(0,str(script.parent));runpy.run_path(str(script),run_name='__main__')
    else:raise SystemExit('Usage: python scripts/python-runtime.py --check | -m MODULE ... | PROJECT_SCRIPT ...')


if __name__=='__main__':main()
