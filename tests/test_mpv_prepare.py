import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('mpv_prepare',ROOT/'scripts/prepare-mpv.py')
prepare=importlib.util.module_from_spec(spec);spec.loader.exec_module(prepare)
sha=lambda data:hashlib.sha256(data).hexdigest()


class MPVPrepareTests(unittest.TestCase):
    def setUp(self):
        (ROOT/'build').mkdir(exist_ok=True)
        self.temporary=tempfile.TemporaryDirectory(prefix='mpv-prepare-test-',dir=ROOT/'build')
        self.addCleanup(self.temporary.cleanup)
        self.root=Path(self.temporary.name);(self.root/'electron').mkdir()
        self.cache=self.root/'build/mpv-download';self.cache.mkdir(parents=True)
        self.target=self.root/'bin/mpv';self.values={'mpv.exe':b'fixture exe','LICENSE.GPL':b'fixture license'}

    def archive(self,extra=None,duplicate=False):
        output=io.BytesIO()
        with warnings.catch_warnings(),zipfile.ZipFile(output,'w') as package:
            warnings.simplefilter('ignore',UserWarning)
            for name,data in self.values.items():package.writestr(name,data)
            if extra:package.writestr(*extra)
            if duplicate:package.writestr('mpv.exe',b'duplicate')
        self.data=output.getvalue()
        self.manifest={'schema':1,'asset':'mpv-fixture.zip','url':'https://github.com/mpv-player/mpv/releases/download/git-release/mpv-fixture.zip','archiveSha256':sha(self.data),'exeSha256':sha(self.values['mpv.exe']),'licenseSha256':sha(self.values['LICENSE.GPL'])}
        self.write_manifest();(self.cache/'runtime.zip').write_bytes(self.data)

    def write_manifest(self):
        (self.root/'electron/mpv-runtime.json').write_text(json.dumps(self.manifest),encoding='utf-8')

    def no_network(self,*args,**kwargs):raise AssertionError('No network permitted')

    def test_offline_cache_whitelist_and_idempotence(self):
        self.archive(extra=('../outside.exe',b'must never extract'))
        result=prepare.prepare(self.root,True,self.no_network)
        self.assertTrue(result['prepared']);self.assertEqual(set(p.name for p in self.target.iterdir()),set(self.values))
        self.assertFalse((self.root/'outside.exe').exists())
        before={p.name:p.stat().st_mtime_ns for p in self.target.iterdir()}
        prepare.prepare(self.root,True,self.no_network)
        self.assertEqual(before,{p.name:p.stat().st_mtime_ns for p in self.target.iterdir()})

    def test_mismatch_preflight_preserves_old_runtime_and_missing_sibling(self):
        self.archive();self.target.mkdir(parents=True);(self.target/'LICENSE.GPL').write_bytes(b'user existing')
        with self.assertRaisesRegex(ValueError,'refusing to overwrite'):prepare.prepare(self.root,True,self.no_network)
        self.assertFalse((self.target/'mpv.exe').exists());self.assertEqual((self.target/'LICENSE.GPL').read_bytes(),b'user existing')

    def test_duplicate_expected_member_is_rejected(self):
        self.archive(duplicate=True)
        with self.assertRaisesRegex(ValueError,'duplicated'):prepare.prepare(self.root,True,self.no_network)
        self.assertFalse(self.target.exists())

    def test_wrong_member_digest_is_rejected_before_writes(self):
        self.archive();self.manifest['exeSha256']='0'*64;self.write_manifest()
        with self.assertRaisesRegex(ValueError,'member checksum'):prepare.prepare(self.root,True,self.no_network)
        self.assertFalse(self.target.exists())

    def test_missing_offline_archive_never_downloads(self):
        self.archive();(self.cache/'runtime.zip').unlink()
        with self.assertRaisesRegex(ValueError,'not cached'):prepare.prepare(self.root,True,self.no_network)

    def test_bad_cached_hash_is_preserved(self):
        self.archive();(self.cache/'runtime.zip').unlink();file=self.cache/(self.manifest['archiveSha256']+'.zip');file.write_bytes(b'bad')
        with self.assertRaisesRegex(ValueError,'checksum mismatch'):prepare.prepare(self.root,True,self.no_network)
        self.assertEqual(file.read_bytes(),b'bad')

    def test_download_mismatch_never_publishes_or_changes_runtime(self):
        self.archive();(self.cache/'runtime.zip').unlink()
        response=io.BytesIO(b'bad');response.geturl=lambda:'https://example.invalid/fixture';response.headers={}
        with self.assertRaisesRegex(ValueError,'download checksum mismatch'):prepare.prepare(self.root,False,lambda *a,**k:response)
        self.assertEqual(list(self.cache.iterdir()),[]);self.assertFalse(self.target.exists())

    def test_verified_download_publishes_content_addressed_cache(self):
        self.archive();(self.cache/'runtime.zip').unlink()
        response=io.BytesIO(self.data);response.geturl=lambda:'https://example.invalid/fixture';response.headers={}
        prepare.prepare(self.root,False,lambda *a,**k:response)
        self.assertEqual((self.cache/(sha(self.data)+'.zip')).read_bytes(),self.data)
        self.assertEqual((self.target/'mpv.exe').read_bytes(),self.values['mpv.exe'])

    def test_arbitrary_download_url_rejected(self):
        self.archive();self.manifest['url']='https://example.invalid/mpv.zip';self.write_manifest()
        with self.assertRaisesRegex(ValueError,'download source'):prepare.prepare(self.root,True,self.no_network)

    def test_linked_cache_rejected(self):
        self.archive();linked=self.root/'linked';linked.mkdir()
        with patch.object(Path,'is_symlink',lambda p:p==self.cache):
            with self.assertRaisesRegex(ValueError,'contains a link'):prepare.prepare(self.root,True,self.no_network)

    def test_publish_failure_rolls_back_only_new_files(self):
        self.archive();original=os.link;count=0
        def link(source,target):
            nonlocal count
            count+=1
            if count==2:raise OSError('simulated publish failure')
            return original(source,target)
        with patch.object(prepare.os,'link',side_effect=link):
            with self.assertRaisesRegex(OSError,'publish failure'):prepare.prepare(self.root,True,self.no_network)
        self.assertEqual(list(self.target.iterdir()),[])
        self.assertEqual(set(p.name for p in self.cache.iterdir()),{'runtime.zip'})

    def test_rollback_does_not_remove_a_concurrently_changed_file(self):
        self.archive();original=os.link;count=0
        def link(source,target):
            nonlocal count
            count+=1
            if count==2:
                (self.target/'mpv.exe').write_bytes(b'concurrent modification')
                raise OSError('simulated publish failure')
            return original(source,target)
        with patch.object(prepare.os,'link',side_effect=link):
            with self.assertRaises(OSError):prepare.prepare(self.root,True,self.no_network)
        self.assertEqual((self.target/'mpv.exe').read_bytes(),b'concurrent modification')

    def test_expected_symlink_member_is_rejected(self):
        self.archive();output=io.BytesIO()
        with zipfile.ZipFile(output,'w') as package:
            entry=zipfile.ZipInfo('mpv.exe');entry.create_system=3;entry.external_attr=0o120777<<16
            package.writestr(entry,self.values['mpv.exe']);package.writestr('LICENSE.GPL',self.values['LICENSE.GPL'])
        data=output.getvalue();self.manifest['archiveSha256']=sha(data);self.write_manifest();(self.cache/'runtime.zip').write_bytes(data)
        with self.assertRaisesRegex(ValueError,'Unsafe'):prepare.prepare(self.root,True,self.no_network)


if __name__=='__main__':unittest.main()
