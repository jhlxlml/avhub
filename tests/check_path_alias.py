"""Reproduce hosted Windows short-TEMP behavior in an owned temporary sandbox."""
import argparse
import ctypes
import os
import sys
import tempfile
import unittest
from pathlib import Path

CASES=[
    'test_data_migration.DataMigrationTests.test_new_default_and_legacy_upgrade',
    'test_library.ScanTests.test_incremental_refresh_preserves_personal_data',
    'test_library.ScanTests.test_nested_registered_roots_are_pruned_and_owned_once',
    'test_library.ScanTests.test_thumbnail_work_is_separate_from_metadata_indexing',
    'test_screenshots.ScreenshotTests.test_custom_directory_and_shortcut_persist_with_fresh_store',
    'test_screenshots.ScreenshotTests.test_default_save_preserves_png_bytes_dimensions_and_source',
    'test_screenshots.ScreenshotTests.test_legacy_shortcuts_normalize_to_c_without_losing_directory',
    'test_stability.LibraryTests.test_sidecar_subtitle_discovery_and_path_scope',
]
def short_path(path):
    if os.name!='nt':return None
    function=ctypes.WinDLL('kernel32',use_last_error=True).GetShortPathNameW
    function.argtypes=[ctypes.c_wchar_p,ctypes.c_wchar_p,ctypes.c_uint32];function.restype=ctypes.c_uint32
    buffer=ctypes.create_unicode_buffer(32768);length=function(str(path),buffer,len(buffer))
    if not 0<length<len(buffer) or Path(buffer.value)==Path(path).resolve():return None
    return Path(buffer.value)
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--all',action='store_true');args=parser.parse_args()
    tests=Path(__file__).resolve().parent;sys.path.insert(0,str(tests));sys.path.insert(0,str(tests.parent))
    with tempfile.TemporaryDirectory(prefix='avhub-ci-alias-regression-') as directory:
        alias=short_path(directory)
        if alias is None:
            print('SKIP: this system does not provide a distinct Windows 8.3 alias');return
        if not alias.samefile(directory):raise RuntimeError('Alias does not identify the owned test directory')
        previous=tempfile.tempdir
        try:
            tempfile.tempdir=str(alias)  # Child test process only; not a user/system setting.
            suite=unittest.defaultTestLoader.discover(str(tests),pattern='test_*.py') if args.all else unittest.defaultTestLoader.loadTestsFromNames(CASES)
            result=unittest.TextTestRunner(verbosity=1).run(suite)
        finally:tempfile.tempdir=previous
        if not result.wasSuccessful():raise SystemExit(1)
        print(f'Windows 8.3 regression passed: {result.testsRun} cases; zero failures')
if __name__=='__main__':main()
