"""Synthetic packaging safety tests, not actual Windows EXE acceptance."""
import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('folder_portable',ROOT/'scripts/folder-portable.py')
folder=importlib.util.module_from_spec(spec);spec.loader.exec_module(folder)

def fixture(directory,version='1.2.3'):
    source=directory/'win-unpacked';source.mkdir()
    for relative in folder.REQUIRED:
        file=source/relative;file.parent.mkdir(parents=True,exist_ok=True)
        file.write_bytes(json.dumps({'version':version,'build_id':'test-build'}).encode() if relative.endswith('build-info.json') else b'MZ-synthetic')
    return source

class FolderPortableTests(unittest.TestCase):
    def test_clean_zip_preserves_bytes_and_has_one_app_root(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory=Path(temporary);source=fixture(directory);target=directory/'app.zip'
            folder.create(source,target,'1.2.3','test-build')
            prefix=folder.verify(target,'1.2.3','test-build')
            with zipfile.ZipFile(target) as archive:
                self.assertEqual(archive.read(prefix+'/AVHub.exe'),(source/'AVHub.exe').read_bytes())
                self.assertTrue(all(name.startswith(prefix+'/') for name in archive.namelist()))
            with self.assertRaises(ValueError):folder.verify(target,'1.2.3','wrong-build')

    def test_private_data_archive_and_media_are_refused_not_silently_omitted(self):
        for relative in ['AVHub-data/library.db','resources/archive/web.js','avhub-data-location.json','resources/private.mp4','resources/backend/backend.log']:
            with self.subTest(relative=relative),tempfile.TemporaryDirectory() as temporary:
                directory=Path(temporary);source=fixture(directory);file=source/relative;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(b'private')
                with self.assertRaises(ValueError):folder.create(source,directory/'app.zip','1.2.3','test-build')
                self.assertFalse((directory/'app.zip').exists())

    def test_missing_dependencies_and_unowned_destination_are_refused(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory=Path(temporary);source=fixture(directory);target=directory/'app.zip'
            (source/'AVHub.exe').unlink()
            with self.assertRaises(ValueError):folder.create(source,target,'1.2.3','test-build')
            (source/'AVHub.exe').write_bytes(b'MZ-synthetic');target.write_bytes(b'user file')
            with self.assertRaises(zipfile.BadZipFile):folder.create(source,target,'1.2.3','test-build')
            self.assertEqual(target.read_bytes(),b'user file')

    def test_zip_traversal_wrong_root_duplicates_and_links_are_refused(self):
        for name,linked in [('root/../../escape',False),('wrong/AVHub.exe',False),('AVHub-folder-portable-1.2.3-x64/resources/link',True)]:
            with self.subTest(name=name),tempfile.TemporaryDirectory() as temporary:
                target=Path(temporary)/'app.zip'
                with zipfile.ZipFile(target,'w') as archive:
                    item=zipfile.ZipInfo(name)
                    if linked:item.external_attr=(0o120777<<16)
                    archive.writestr(item,b'fake')
                with self.assertRaises(ValueError):folder.verify(target,'1.2.3')

    def test_case_insensitive_zip_duplicates_are_refused(self):
        with tempfile.TemporaryDirectory() as temporary:
            target=Path(temporary)/'app.zip';prefix=folder.folder_name('1.2.3')
            with zipfile.ZipFile(target,'w') as archive:
                archive.writestr(prefix+'/AVHub.exe',b'MZ');archive.writestr(prefix+'/avhub.EXE',b'MZ')
            with self.assertRaises(ValueError):folder.verify(target,'1.2.3')
