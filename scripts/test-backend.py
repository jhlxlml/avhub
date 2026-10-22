"""Local and CI backend entry point; invoke through python-runtime.py."""
import argparse
from pathlib import Path
import sys
import unittest


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--short-path',action='store_true')
    parser.add_argument('--require-alias',action='store_true')
    args=parser.parse_args()
    tests=Path(__file__).resolve().parents[1]/'tests'
    sys.path.insert(0,str(tests))
    if args.short_path:
        import check_path_alias
        check_path_alias.main(['--all',*(['--require-alias'] if args.require_alias else [])])
    else:
        if args.require_alias:parser.error('--require-alias requires --short-path')
        from backend_report import run
        result=run(unittest.defaultTestLoader.discover(str(tests),pattern='test_*.py'))
        if not result.wasSuccessful():raise SystemExit(1)


if __name__=='__main__':main()
