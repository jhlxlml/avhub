"""Synthetic packaging safety tests, not actual Windows EXE acceptance."""
import importlib.util
import json
import tempfile
import unittest
import zipfile
import contextlib
import io
import shutil
import hashlib
from unittest.mock import patch
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('folder_portable',ROOT/'scripts/folder-portable.py')
folder=importlib.util.module_from_spec(spec);spec.loader.exec_module(folder)

def fixture(directory,version='1.2.3'):
    source=directory/'win-unpacked';source.mkdir()
    for relative in folder.REQUIRED:
        file=source/relative;file.parent.mkdir(parents=True,exist_ok=True)
        file.write_bytes(json.dumps({'version':version,'build_id':'test-build'}).encode() if relative.endswith('build-info.json') else b'MZ-synthetic')
    internal=source/'resources/backend/_internal'
    for name in ('FFmpeg-LICENSE.txt','FFmpeg-BUILD-INFO.txt','SQLite-LICENSE.txt','SQLite-BUILD-INFO.txt'):
        file=internal/'licenses'/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_text('Synthetic notice')
    (internal/'app/static').mkdir(parents=True,exist_ok=True);(internal/'app/static/third-party-ui-licenses.txt').write_text('Synthetic UI notice')
    content=b'Synthetic dependency notice';digest=hashlib.sha256(content).hexdigest()
    back=internal/'licenses/python-distributions';back.mkdir();(back/'LICENSE').write_bytes(content)
    (back/'inventory.json').write_text(json.dumps({'schema':1,'packages':[{'name':'synthetic'}],'files':[{'path':'LICENSE','size':len(content),'sha256':digest}]}))
    front=internal/'app/static/third-party';(front/'npm/demo').mkdir(parents=True);(front/'npm/demo/LICENSE').write_bytes(content)
    (front/'frontend-notices.json').write_text(json.dumps({'schema':1,'packages':[{'name':'synthetic','notices':[{'path':'third-party/npm/demo/LICENSE','sha256':digest}]}]}))
    return source

def ffi_fixture(destination):
    # Exact pinned native bytes, copied as the shipped allowlisted closure;
    # exclude development package/lock files from the prepared cache.
    pin=json.loads((ROOT/'ci/render-ffi/runtime-manifest.json').read_text())
    for item in pin['files']:
        data=(ROOT/'build/libmpv-render-spike/ffi'/item['name']).read_bytes()
        if len(data)!=item['size'] or hashlib.sha256(data).hexdigest()!=item['sha256']:raise ValueError('Prepared FFI input differs from pin')
        target=destination/item['name'];target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
    (destination/'runtime-manifest.json').write_text(json.dumps(pin),encoding='utf-8')

class FolderPortableTests(unittest.TestCase):
    def test_independent_runtime_missing_or_changed_dependency_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            directory=Path(directory);runtime=fixture(directory);mpv=runtime/'resources/mpv';mpv.mkdir()
            members={'mpv.exe':b'MZ-independent','LICENSE.GPL':b'GPL fixture','lua51.dll':b'MZ-lua'}
            for name,content in members.items():(mpv/name).write_bytes(content)
            digest=lambda name:hashlib.sha256(members[name]).hexdigest()
            (mpv/'runtime.json').write_text(json.dumps({'schema':1,'exeSha256':digest('mpv.exe'),
                'licenseSha256':digest('LICENSE.GPL'),'dependencies':[{'name':'lua51.dll','size':len(members['lua51.dll']),'sha256':digest('lua51.dll')}]}))
            target=directory/'portable.zip';folder.create(runtime,target,'1.2.3','test-build')
            (mpv/'lua51.dll').unlink()
            with self.assertRaisesRegex(ValueError,'Independent MPV member missing'):folder.create(runtime,directory/'missing.zip','1.2.3','test-build')
            (mpv/'lua51.dll').write_bytes(b'MZ-bad')
            with self.assertRaisesRegex(ValueError,'Independent MPV member changed'):folder.create(runtime,directory/'changed.zip','1.2.3','test-build')

    def test_notice_inventory_is_checked_in_input_and_archived_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory=Path(temporary);source=fixture(directory);target=directory/'app.zip';folder.create(source,target,'1.2.3','test-build')
            notice=source/'resources/backend/_internal/app/static/third-party/npm/demo/LICENSE';notice.write_text('replaced')
            with self.assertRaisesRegex(ValueError,'notice identity'):folder.create(source,directory/'bad.zip','1.2.3','test-build')
            foreign=directory/'foreign.zip'
            with zipfile.ZipFile(target) as archive,zipfile.ZipFile(foreign,'w') as output:
                for item in archive.infolist():output.writestr(item,b'replaced' if item.filename.endswith('/npm/demo/LICENSE') else archive.read(item))
            with self.assertRaisesRegex(ValueError,'notice identity'):folder.verify(foreign,'1.2.3')

    def test_missing_or_traversing_notice_inventory_is_rejected(self):
        for relative in (None,'../../outside'):
            with self.subTest(relative=relative),tempfile.TemporaryDirectory() as temporary:
                directory=Path(temporary);source=fixture(directory)
                inventory=source/'resources/backend/_internal/licenses/python-distributions/inventory.json'
                if relative is None:inventory.unlink()
                else:
                    data=json.loads(inventory.read_text());data['files'][0]['path']=relative;inventory.write_text(json.dumps(data))
                with self.assertRaises(ValueError):folder.create(source,directory/'bad.zip','1.2.3','test-build')

    def test_pinned_native_ffi_closure_roundtrip_and_tampering(self):
        # Actual pinned runtime bytes in a synthetic base package; this is not
        # another real Electron/clean-machine acceptance.
        with tempfile.TemporaryDirectory() as temporary:
            directory=Path(temporary);source=fixture(directory)
            destination=source/'resources/native-render/ffi';ffi_fixture(destination)
            target=directory/'app.zip';folder.create(source,target,'1.2.3','test-build')
            folder.verify(target,'1.2.3','test-build')
            addon=destination/'node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node'
            original=addon.read_bytes();addon.write_bytes(original[:-1]+bytes([original[-1]^1]))
            with self.assertRaisesRegex(ValueError,'identity mismatch'):
                folder.create(source,directory/'tampered.zip','1.2.3','test-build')
            # Reading a foreign/modified ZIP must enforce the same pin as
            # building one; its own manifest cannot approve the replacement.
            forged_zip=directory/'foreign.zip'
            with zipfile.ZipFile(target) as archive,zipfile.ZipFile(forged_zip,'w') as output:
                for item in archive.infolist():
                    content=archive.read(item)
                    if item.filename.endswith('/win32_x64/koffi.node'):content=addon.read_bytes()
                    output.writestr(item,content)
            with self.assertRaisesRegex(ValueError,'identity mismatch'):folder.verify(forged_zip,'1.2.3')
            addon.write_bytes(original)
            manifest=destination/'runtime-manifest.json';pin=json.loads(manifest.read_text());pin['files'][-1]['sha256']='0'*64;manifest.write_text(json.dumps(pin))
            with self.assertRaisesRegex(ValueError,'repository pin'):
                folder.create(source,directory/'forged.zip','1.2.3','test-build')

    def test_native_exception_never_admits_extra_modules_or_private_files(self):
        for extra in ['resources/native-render/ffi/node_modules/extra/index.js',
                      'resources/native-render/ffi/node_modules/koffi/private.mp4',
                      'node_modules/koffi/index.cjs','AVHub-data/library.db']:
            with self.subTest(extra=extra),tempfile.TemporaryDirectory() as temporary:
                directory=Path(temporary);source=fixture(directory)
                ffi_fixture(source/'resources/native-render/ffi')
                file=source/extra;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(b'not shipped')
                with self.assertRaises(ValueError):folder.create(source,directory/'app.zip','1.2.3','test-build')

    def test_native_runtime_without_its_ffi_closure_is_refused(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory=Path(temporary);source=fixture(directory)
            native=source/'resources/native-render';native.mkdir();(native/'libmpv-2.dll').write_bytes(b'MZ-not-a-complete-runtime')
            with self.assertRaisesRegex(ValueError,'missing its FFI closure'):
                folder.create(source,directory/'app.zip','1.2.3','test-build')

    def test_explicit_candidate_directory_leaves_default_release_output_untouched(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'app').mkdir();(root/'dist/electron').mkdir(parents=True)
            (root/'package.json').write_text(json.dumps({'version':'1.2.3'}))
            (root/'app/build-info.json').write_text(json.dumps({'build_id':'test-build'}))
            sentinel=root/'dist/electron/old-release.zip';sentinel.write_bytes(b'old release')
            candidate=root/'owned-candidate';candidate.mkdir();fixture(candidate)
            with patch.object(folder,'ROOT',root),patch('sys.argv',['folder-portable.py','--directory',str(candidate)]),contextlib.redirect_stdout(io.StringIO()):
                folder.main()
            target=candidate/(folder.folder_name('1.2.3')+'.zip')
            folder.verify(target,'1.2.3','test-build')
            extracted=root/'extracted'
            with patch.object(folder,'ROOT',root),patch('sys.argv',['folder-portable.py','--directory',str(candidate),'--extract-to',str(extracted)]),contextlib.redirect_stdout(io.StringIO()):
                folder.main()
            self.assertTrue((extracted/folder.folder_name('1.2.3')/'AVHub.exe').is_file())
            self.assertEqual(sentinel.read_bytes(),b'old release')
            self.assertEqual(list((root/'dist/electron').iterdir()),[sentinel])

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
