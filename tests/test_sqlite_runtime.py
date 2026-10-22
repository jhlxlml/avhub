"""Runtime safety / generated real-schema compatibility, never the user's library."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from app import sqlite_runtime as runtime

ROOT=Path(__file__).resolve().parents[1]


def load_script(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/f'{name}.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module


class SQLiteRuntimeTests(unittest.TestCase):
    def child(self,code,*args,success=True):
        result=subprocess.run([sys.executable,'-c',code,*map(str,args)],cwd=ROOT,capture_output=True,text=True,
            encoding='utf-8',env={**os.environ,'PYTHONUTF8':'1'},timeout=30)
        if success:self.assertEqual(result.returncode,0,result.stderr)
        else:self.assertNotEqual(result.returncode,0)
        return result

    def test_manifest_is_fixed_official_x64_and_patched(self):
        value=runtime.manifest()
        self.assertEqual(value['version'],'3.54.1');self.assertEqual(value['architecture'],'x64')
        self.assertTrue(value['url'].startswith('https://sqlite.org/2026/'))
        self.assertEqual(len(value['archive_sha3_256']),64);self.assertEqual(len(value['dll_sha256']),64)

    def test_invalid_manifest_is_rejected(self):
        value=runtime.manifest()
        for changed in ({'url':'https://example.com/sqlite.dll'},{'version':'../escape'},{'dll_sha256':'bad'},{'dll_bytes':True},{'architecture':'x86'}):
            with self.subTest(changed=changed),patch.object(Path,'read_text',return_value=json.dumps(value|changed)):
                with self.assertRaises(RuntimeError):runtime.manifest()

    def test_frozen_path_uses_private_bundle_not_python_or_cwd(self):
        with tempfile.TemporaryDirectory(prefix='avhub-sqlite-path-') as owned:
            with patch.object(sys,'frozen',True,create=True),patch.object(sys,'_MEIPASS',owned,create=True):
                self.assertEqual(runtime.runtime_path(runtime.manifest()),Path(owned).resolve()/'sqlite3.dll')

    def test_missing_corrupt_and_wrong_architecture_are_rejected_before_load(self):
        with tempfile.TemporaryDirectory(prefix='avhub-sqlite-corrupt-') as owned:
            target=Path(owned)/'sqlite3.dll';info=runtime.manifest()
            with self.assertRaises(RuntimeError):runtime.validate_binary(target,info)
            target.write_bytes(b'owned corrupt binary')
            with self.assertRaises(RuntimeError):runtime.validate_binary(target,info)
            data=bytearray(128);data[:2]=b'MZ';struct.pack_into('<I',data,60,80);data[80:86]=b'PE\0\0\x4c\x01';target.write_bytes(data)
            with self.assertRaisesRegex(RuntimeError,'x64'):
                runtime.validate_binary(target,{'dll_bytes':len(data),'dll_sha256':hashlib.sha256(data).hexdigest()})

    def test_prepare_refuses_corrupt_existing_file_without_overwrite_or_network(self):
        prepare=load_script('prepare-sqlite')
        with tempfile.TemporaryDirectory(prefix='avhub-sqlite-existing-') as owned:
            target=Path(owned)/'sqlite3.dll';target.write_bytes(b'owned existing binary')
            with patch.object(prepare,'runtime_path',return_value=target),patch.object(prepare,'urlopen') as network:
                with self.assertRaises(RuntimeError):prepare.prepare()
                network.assert_not_called()
            self.assertEqual(target.read_bytes(),b'owned existing binary')

    def test_prepare_rejects_corrupt_cached_archive_before_extraction(self):
        prepare=load_script('prepare-sqlite');info=runtime.manifest()
        with tempfile.TemporaryDirectory(prefix='avhub-sqlite-archive-') as owned:
            root=Path(owned).resolve();downloads=root/'build/downloads';downloads.mkdir(parents=True)
            archive=downloads/Path(info['url']).name;archive.write_bytes(b'owned corrupt archive')
            target=root/'bin/sqlite/sqlite3.dll'
            with patch.object(prepare,'ROOT',root),patch.object(prepare,'runtime_path',return_value=target),patch.object(prepare,'urlopen') as network:
                with self.assertRaisesRegex(RuntimeError,'archive hash mismatch'):prepare.prepare()
                network.assert_not_called()
            self.assertFalse(target.exists());self.assertEqual(archive.read_bytes(),b'owned corrupt archive')

    def test_bundle_rejects_host_dll_and_duplicate_engine(self):
        verifier=load_script('verify-bundled-sqlite');info=runtime.manifest()
        with tempfile.TemporaryDirectory(prefix='avhub-sqlite-bundle-') as owned:
            root=Path(owned);(root/'_internal/app').mkdir(parents=True)
            (root/'_internal/app/sqlite-runtime.json').write_text(json.dumps(info))
            binary=root/'_internal/sqlite3.dll';binary.write_bytes(b'owned wrong engine')
            with self.assertRaisesRegex(RuntimeError,'校验失败'):verifier.verify(root)
            (root/'other').mkdir();(root/'other/sqlite3.dll').write_bytes(b'owned duplicate')
            with self.assertRaisesRegex(RuntimeError,'exactly one'):verifier.verify(root)

    @unittest.skipUnless(sys.platform=='win32','Windows desktop startup')
    def test_missing_engine_prevents_creation_of_application_data(self):
        with tempfile.TemporaryDirectory(prefix='avhub-sqlite-startup-') as owned:
            result=self.child("from pathlib import Path;import os,sys;from app import sqlite_runtime as r;os.environ['AVHUB_DATA_DIR']=str(Path(sys.argv[1])/'data');r.runtime_path=lambda _:Path(sys.argv[1])/'missing.dll';import run",owned,success=False)
            self.assertIn('prepare:sqlite',result.stderr);self.assertFalse((Path(owned)/'data').exists())

    @unittest.skipUnless(sys.platform=='win32','Windows private DLL loader')
    def test_new_process_actual_engine_idempotence_and_immutable_report(self):
        result=self.child("from app.sqlite_runtime import initialize,status;import json;v=initialize();v['compile_options'].clear();print(json.dumps(status()));assert initialize()['compile_options']")
        data=json.loads(result.stdout);self.assertEqual(data['version'],runtime.manifest()['version'])
        self.assertEqual(data['source_id'],runtime.manifest()['source_id']);self.assertTrue(data['verified'])
        self.assertIn('THREADSAFE=1',data['compile_options']);self.assertNotIn(str(ROOT),result.stdout)

    @unittest.skipUnless(sys.platform=='win32','Windows private DLL loader')
    def test_already_loaded_host_cannot_silently_claim_private_engine(self):
        result=self.child("import sqlite3;from app.sqlite_runtime import initialize;initialize()",success=False)
        self.assertIn('scripts/python-runtime.py',result.stderr)

    @unittest.skipUnless(sys.platform=='win32','Windows runtime / old-engine interoperability')
    def test_old_new_backup_restore_restart_and_rollback_on_generated_application_schema(self):
        with tempfile.TemporaryDirectory(prefix='avhub-sqlite-compat-') as owned:
            folder=Path(owned)
            seed=self.child(r'''
import os,sys,sqlite3,json
from pathlib import Path
from contextlib import closing
p=Path(sys.argv[1]);os.environ['AVHUB_DATA_DIR']=str(p/'data')
from app import main as m
m.bootstrap();m.db_anchor.start(m.DB)
v=p/'Owned source.mp4';v.write_bytes(b'owned unchanged media fixture')
with m.connection() as db:
    db.execute("INSERT INTO media(id,path,name,title,duration,created_at,updated_at,progress,favorite,tags) VALUES(1,?,'Owned source.mp4','Owned 标题',120,0,0,37,1,'[\"personal\"]')",(str(v),))
    db.execute("INSERT INTO playlists(id,name,created_at) VALUES(1,'Owned list',0)")
    db.execute('INSERT INTO playlist_items(playlist_id,media_id,position) VALUES(1,1,0)')
with closing(sqlite3.connect(m.DB)) as src,closing(sqlite3.connect(p/'old-backup.db')) as dst:src.backup(dst)
print(json.dumps({'version':sqlite3.sqlite_version,'progress':37}),flush=True)
os._exit(0)  # Committed WAL intentionally survives this isolated child.
''',folder)
            old=json.loads(seed.stdout);self.assertEqual(old['progress'],37)
            source=folder/'data/library.db';self.assertTrue(source.with_name('library.db-wal').exists())
            update=r'''
import sys,json
from pathlib import Path
from contextlib import closing
if sys.argv[2]=='private':
    from app.sqlite_runtime import initialize
    initialize()
import sqlite3
p=Path(sys.argv[1]);phase=sys.argv[3]
target=p/'data/library.db' if phase=='upgrade' else p/'new-backup.db'
with closing(sqlite3.connect(target)) as db:
    assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
    assert db.execute('PRAGMA synchronous').fetchone()[0]==2
    assert db.execute('PRAGMA wal_autocheckpoint').fetchone()[0]==1000
    row=db.execute('SELECT progress,favorite,tags,title FROM media WHERE id=1').fetchone()
    assert row==(37 if phase=='upgrade' else 74,1,'["personal"]','Owned 标题'),row
    assert db.execute('SELECT COUNT(*) FROM playlist_items').fetchone()[0]==1
    if phase=='upgrade':
        with closing(sqlite3.connect(p/'old-backup.db')) as backup:assert backup.execute('SELECT progress FROM media').fetchone()[0]==37
    db.execute('UPDATE media SET progress=? WHERE id=1',(74 if phase=='upgrade' else 91,));db.commit()
    with closing(sqlite3.connect(p/('new-backup.db' if phase=='upgrade' else 'rollback-backup.db'))) as dst:db.backup(dst)
print(json.dumps({'version':sqlite3.sqlite_version,'phase':phase}))
'''
            newer=json.loads(self.child(update,folder,'private','upgrade').stdout)
            rollback=json.loads(self.child(update,folder,'host','rollback').stdout)
            final=self.child(r'''
from app.sqlite_runtime import initialize
initialize()
import sqlite3,sys
from pathlib import Path
from contextlib import closing
p=Path(sys.argv[1])
with closing(sqlite3.connect(p/'restored.db')) as dst,closing(sqlite3.connect(p/'rollback-backup.db')) as src:
    src.backup(dst)
    assert dst.execute('SELECT progress FROM media').fetchone()[0]==91
    assert dst.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    assert dst.execute('PRAGMA foreign_key_check').fetchall()==[]
assert (p/'Owned source.mp4').read_bytes()==b'owned unchanged media fixture'
''',folder)
            self.assertEqual(newer['version'],'3.54.1');self.assertEqual(rollback['version'],old['version'])
            self.assertEqual(final.returncode,0)


if __name__=='__main__':unittest.main()
