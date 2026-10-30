import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('candidate_prepare',ROOT/'scripts/prepare-mpv.py')
prepare=importlib.util.module_from_spec(spec);spec.loader.exec_module(prepare)
sha=lambda value:hashlib.sha256(value).hexdigest()


class CandidatePrepareTests(unittest.TestCase):
    def setUp(self):
        (ROOT/'build').mkdir(exist_ok=True)
        self.temporary=tempfile.TemporaryDirectory(prefix='mpv-candidate-test-',dir=ROOT/'build');self.addCleanup(self.temporary.cleanup)
        self.root=Path(self.temporary.name);(self.root/'ci').mkdir();self.cache=self.root/'build/mpv-stable-candidate';self.cache.mkdir(parents=True)
        self.target=self.cache/'verified-runtime';self.binary={'mpv.exe':b'fixture exe','codec.dll':b'fixture codec'}
        self.default=self.root/'bin/mpv/mpv.exe';self.default.parent.mkdir(parents=True);self.default.write_bytes(b'original runtime stays')
        self.make_archive()

    def make_archive(self,duplicate=False,tamper=False):
        inner=io.BytesIO()
        with zipfile.ZipFile(inner,'w') as package:
            for name,data in self.binary.items():package.writestr(name,b'tampered' if tamper and name=='codec.dll' else data)
            package.writestr('../outside.dll',b'not extracted');package.writestr('mpv-register.bat',b'not extracted')
        outer=io.BytesIO()
        with warnings.catch_warnings(),zipfile.ZipFile(outer,'w') as package:
            warnings.simplefilter('ignore',UserWarning);package.writestr('mpv-inner.zip',inner.getvalue())
            if duplicate:package.writestr('mpv-inner.zip',inner.getvalue())
        self.data=outer.getvalue()
        self.value={'schema':1,'status':'candidate-only','distributionReady':False,'releaseTag':'v0.41.0','sourceCommit':'a'*40,'asset':'mpv-fixture.zip','url':'https://github.com/mpv-player/mpv/releases/download/v0.41.0/mpv-fixture.zip','archiveSha256':sha(self.data),'innerArchive':{'name':'mpv-inner.zip','sha256':sha(inner.getvalue())},'files':[{'name':name,'size':len(data),'sha256':sha(data)} for name,data in self.binary.items()]}
        self.save();(self.cache/'runtime.zip').write_bytes(self.data)

    def save(self):
        (self.root/'ci/mpv-stable-candidate.json').write_text(json.dumps(self.value),encoding='utf-8')

    def offline(self,*args,**kwargs):raise AssertionError('No network allowed')

    def verify_default(self):self.assertEqual(self.default.read_bytes(),b'original runtime stays')

    def test_nested_whitelist_and_repeated_offline_preparation(self):
        report=prepare.prepare_candidate(self.root,True,self.offline)
        self.assertFalse(report['installedAsDefault']);self.assertFalse(report['distributionReady'])
        self.assertEqual(set(p.name for p in self.target.iterdir()),set(self.binary));self.assertFalse((self.cache/'outside.dll').exists())
        before={p.name:p.stat().st_mtime_ns for p in self.target.iterdir()}
        prepare.prepare_candidate(self.root,True,self.offline)
        self.assertEqual(before,{p.name:p.stat().st_mtime_ns for p in self.target.iterdir()});self.verify_default()

    def test_mismatched_dll_is_not_overwritten(self):
        self.target.mkdir();(self.target/'codec.dll').write_bytes(b'user file')
        with self.assertRaisesRegex(ValueError,'refusing to overwrite'):prepare.prepare_candidate(self.root,True,self.offline)
        self.assertFalse((self.target/'mpv.exe').exists());self.assertEqual((self.target/'codec.dll').read_bytes(),b'user file');self.verify_default()

    def test_extra_dll_is_rejected_without_cleanup(self):
        self.target.mkdir();(self.target/'extra.dll').write_bytes(b'preserve')
        with self.assertRaisesRegex(ValueError,'Unexpected binary'):prepare.prepare_candidate(self.root,True,self.offline)
        self.assertEqual([p.name for p in self.target.iterdir()],['extra.dll']);self.verify_default()

    def test_tampered_inner_member_never_publishes_runtime(self):
        self.make_archive(tamper=True)
        with self.assertRaisesRegex(ValueError,'size mismatch|checksum mismatch'):prepare.prepare_candidate(self.root,True,self.offline)
        self.assertFalse(self.target.exists());self.verify_default()

    def test_duplicate_inner_archive_rejected(self):
        self.make_archive(duplicate=True)
        with self.assertRaisesRegex(ValueError,'duplicated'):prepare.prepare_candidate(self.root,True,self.offline)
        self.assertFalse(self.target.exists())

    def test_invalid_catalog_paths_and_case_duplicates_rejected(self):
        for change in ('path','case'):
            self.make_archive()
            if change=='path':self.value['files'][0]['name']='../mpv.exe'
            else:self.value['files'].append(dict(self.value['files'][0],name='MPV.exe'))
            self.save()
            with self.assertRaisesRegex(ValueError,'binary name'):prepare.prepare_candidate(self.root,True,self.offline)
        self.verify_default()

    def test_inner_traversal_and_distribution_promotion_rejected(self):
        self.value['innerArchive']['name']='../mpv-inner.zip';self.save()
        with self.assertRaisesRegex(ValueError,'archive name'):prepare.prepare_candidate(self.root,True,self.offline)
        self.make_archive();self.value['distributionReady']=True;self.save()
        with self.assertRaisesRegex(ValueError,'isolated'):prepare.prepare_candidate(self.root,True,self.offline)

    def test_downloaded_candidate_uses_addressed_cache(self):
        (self.cache/'runtime.zip').unlink();response=io.BytesIO(self.data);response.geturl=lambda:self.value['url'];response.headers={}
        prepare.prepare_candidate(self.root,False,lambda *a,**k:response)
        self.assertTrue((self.cache/(sha(self.data)+'.zip')).is_file());self.verify_default()

    def test_low_staging_space_preserves_candidate_and_default(self):
        with patch.object(prepare.shutil,'disk_usage',return_value=type('Usage',(),{'free':1})()):
            with self.assertRaisesRegex(ValueError,'free space'):prepare.prepare_candidate(self.root,True,self.offline)
        self.assertFalse(self.target.exists());self.verify_default()

    def make_sources(self,prefix=None):
        revision=self.value['sourceCommit'];output=io.BytesIO()
        with zipfile.ZipFile(output,'w') as package:
            package.writestr((prefix or f'mpv-{revision}/')+'configure',b'fixture data, never execute')
        self.source_data=output.getvalue();self.source_cache=self.root/'build/mpv-candidate-sources';self.source_cache.mkdir(exist_ok=True)
        self.source_entry={'component':'mpv','revision':revision,'url':f'https://codeload.github.com/mpv-player/mpv/zip/{revision}','name':f'mpv-{revision}.zip','size':len(self.source_data),'sha256':sha(self.source_data)}
        self.source_catalog={'schema':1,'runtimeArchiveSha256':self.value['archiveSha256'],'archives':[self.source_entry]}
        self.save_sources();(self.source_cache/self.source_entry['name']).write_bytes(self.source_data)

    def save_sources(self):
        (self.root/'ci/mpv-candidate-sources.json').write_text(json.dumps(self.source_catalog),encoding='utf-8')

    def test_source_archives_offline_without_extraction_or_execution(self):
        self.make_sources();report=prepare.prepare_sources(self.root,True,self.offline)
        self.assertEqual(report['archivesVerified'],1);self.assertFalse(report['executedSource']);self.assertFalse(report['distributionReady'])
        self.assertEqual([p.name for p in self.source_cache.iterdir()],[self.source_entry['name']]);self.verify_default()

    def test_wrong_repository_source_url_is_rejected(self):
        self.make_sources();self.source_entry['url']='https://example.invalid/source.zip';self.save_sources()
        with self.assertRaisesRegex(ValueError,'source URL'):prepare.prepare_sources(self.root,True,self.offline)

    def test_source_archive_root_and_candidate_binding_must_match(self):
        self.make_sources(prefix='wrong-commit/')
        with self.assertRaisesRegex(ValueError,'repository revision'):prepare.prepare_sources(self.root,True,self.offline)
        self.source_catalog['runtimeArchiveSha256']='0'*64;self.save_sources()
        with self.assertRaisesRegex(ValueError,'does not match'):prepare.prepare_sources(self.root,True,self.offline)

    def test_offline_sources_never_download_and_bad_hash_is_preserved(self):
        self.make_sources();file=self.source_cache/self.source_entry['name'];file.unlink()
        with self.assertRaisesRegex(ValueError,'not cached'):prepare.prepare_sources(self.root,True,self.offline)
        file.write_bytes(b'bad source')
        with self.assertRaisesRegex(ValueError,'checksum mismatch'):prepare.prepare_sources(self.root,True,self.offline)
        self.assertEqual(file.read_bytes(),b'bad source');self.verify_default()

    def test_sources_cannot_duplicate_a_component(self):
        self.make_sources();self.source_catalog['archives'].append(self.source_entry);self.save_sources()
        with self.assertRaisesRegex(ValueError,'duplicate source'):prepare.prepare_sources(self.root,True,self.offline)


if __name__=='__main__':unittest.main()
