import importlib.util
import json
import io
import contextlib
import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import yaml
from test_folder_portable import folder,fixture
ROOT=Path(__file__).resolve().parents[1]
def module(name,file):
    spec=importlib.util.spec_from_file_location(name,ROOT/file);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
prepare=module('ci_prepare','scripts/ci-prepare.py');artifacts=module('ci_artifacts','scripts/ci-artifacts.py')
publisher=module('ci_publisher','scripts/publish-release.py')
class CITests(unittest.TestCase):
    def test_new_ui_regressions_and_downloader_policy_are_in_ci(self):
        workflow=yaml.load((ROOT/'.github/workflows/windows.yml').read_text(),Loader=yaml.BaseLoader)
        commands='\n'.join(step.get('run','') for step in workflow['jobs']['verify']['steps'])
        for name in ('borderless-controls','content-feedback','dialog-layout','directory-detail-polish',
                     'directory-settings','form-hints','mira-design','mira-followup','mira-navigation',
                     'pagination-layout','queue-feedback','settings-consistency','settings-scroll','workspace-consistency'):
            with self.subTest(name=name):
                self.assertIn(f'tests/ui/{name}.spec.ts',commands)
                self.assertTrue((ROOT/f'tests/ui/{name}.spec.ts').is_file())
        self.assertIn('electron/test/build-dependency-policy.mjs',commands)
        self.assertIn('electron/test/playback-timeline.test.mjs',commands)
        self.assertIn('electron/test/steady-frame-observation.test.mjs',commands)
        self.assertIn('npm audit --audit-level=moderate',commands)
        self.assertIn('electron/test/file-preview.test.mjs',commands)
        self.assertIn('electron/test/file-preview.mjs',commands)

    def test_sqlite_is_prepared_before_tests_and_no_system_dll_is_replaced(self):
        workflow=yaml.load((ROOT/'.github/workflows/windows.yml').read_text(),Loader=yaml.BaseLoader)
        steps=workflow['jobs']['verify']['steps']
        prepare_index=next(i for i,s in enumerate(steps) if s.get('name')=='Prepare and verify pinned private SQLite')
        backend_index=next(i for i,s in enumerate(steps) if s.get('name')=='Backend regression')
        self.assertLess(prepare_index,backend_index)
        self.assertIn('python scripts/python-runtime.py --check',steps[prepare_index]['run'])
        self.assertEqual(steps[backend_index]['run'],'npm run test:backend')
        package=json.loads((ROOT/'package.json').read_text())
        self.assertIn('python-runtime.py',package['scripts']['test:backend'])
        self.assertIn('python-runtime.py',package['scripts']['benchmark:library'])
        self.assertIn('python-runtime.py',package['scripts']['benchmark:scan'])
        build=(ROOT/'scripts/build-windows.ps1').read_text(encoding='utf-8')
        self.assertIn('--runtime-hook "$projectRoot\\scripts\\pyi-sqlite-runtime.py"',build)
        self.assertIn('--add-binary "$sqliteBinary;."',build)
        self.assertLess(build.index('python scripts/verify-bundled-sqlite.py'),build.index('npm run package:windows'))
        self.assertIn('resources/backend/_internal/sqlite3.dll',folder.REQUIRED)

    def test_tag_matches_metadata_and_requires_release_notes(self):
        version=json.loads((ROOT/'package.json').read_text())['version']
        self.assertEqual(prepare.validate_release('v'+version),version)
        with self.assertRaises(ValueError):prepare.validate_release('v0.0.0')
    def test_workflow_has_minimal_permissions_and_pins_actions(self):
        package=json.loads((ROOT/'package.json').read_text())
        backend=next(resource for resource in package['build']['extraResources'] if resource['to']=='backend')
        self.assertIn('!**/.*/**',backend['filter'])
        workflow=yaml.load((ROOT/'.github/workflows/windows.yml').read_text(),Loader=yaml.BaseLoader)
        self.assertEqual(workflow['permissions']['contents'],'read')
        self.assertEqual(workflow['jobs']['publish']['permissions']['contents'],'write')
        self.assertIn("github.event_name == 'push'",workflow['jobs']['publish']['if'])
        self.assertIn("github.repository == 'jhlxlml/avhub'",workflow['jobs']['publish']['if'])
        for job in workflow['jobs'].values():
            for step in job['steps']:
                if 'uses' in step:self.assertRegex(step['uses'],r'@([a-f0-9]{40})$')
                if step.get('name')=='Package only tags or explicit manual runs':self.assertIn('workflow_dispatch',step['if'])
        steps=workflow['jobs']['verify']['steps']
        folder_check=next(step for step in steps if step.get('name')=='Actual extracted folder ZIP acceptance')
        self.assertIn('--folder',folder_check['run']);self.assertIn('workflow_dispatch',folder_check['if'])
        upload=next(step for step in steps if step.get('name')=='Save verified release files')
        self.assertIn('AVHub-folder-portable-*-x64.zip',upload['with']['path'])
    def test_manifest_rejects_corruption_or_different_source(self):
        with tempfile.TemporaryDirectory() as directory:
            directory=Path(directory);file=directory/'AVHub-portable-1.2.3-x64.exe';file.write_bytes(b'MZ-test')
            archive=directory/artifacts.names('1.2.3')[1];folder.create(fixture(directory),archive,'1.2.3','test-build')
            records=[{'filename':asset.name,'bytes':asset.stat().st_size,'sha256':artifacts.digest(asset)} for asset in (file,archive)]
            info={'schema':2,'version':'1.2.3','commit':'a'*40,'build_id':'test-build','artifacts':records}
            (directory/'release-build.json').write_text(json.dumps(info));(directory/'SHA256SUMS.txt').write_text(artifacts.checksums(records))
            self.assertEqual(artifacts.verify(directory,'1.2.3','a'*40),info)
            with self.assertRaises(ValueError):artifacts.verify(directory,'1.2.3','b'*40)
            original=archive.read_bytes();archive.write_bytes(original+b'changed')
            with self.assertRaises(ValueError):artifacts.verify(directory,'1.2.3','a'*40)
            archive.write_bytes(original)
            file.write_bytes(b'MZ-bad')
            with self.assertRaises(ValueError):artifacts.verify(directory,'1.2.3','a'*40)
    def test_ci_publisher_resumes_only_its_draft_and_handles_empty_delete_responses(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'dist/electron').mkdir(parents=True);(root/'docs').mkdir()
            (root/'package.json').write_text('{"version":"1.2.3"}')
            (root/'docs/RELEASE-1.2.3.md').write_text('notes')
            (root/'dist/electron/AVHub-portable-1.2.3-x64.exe').write_bytes(b'MZ-test')
            (root/'dist/electron/AVHub-folder-portable-1.2.3-x64.zip').write_bytes(b'fake ZIP for mocked publisher')
            (root/'dist/electron/SHA256SUMS.txt').write_text('two assets verified by mock')
            (root/'dist/electron/release-build.json').write_text('{}')
            sha='a'*40;draft={'id':1,'tag_name':'v1.2.3','draft':True,'prerelease':False,'target_commitish':sha,'body':publisher.release_body('notes','1.2.3',sha,True),'assets':[{'id':77,'name':'AVHub-portable-1.2.3-x64.exe','state':'uploaded','size':1,'digest':'wrong'}]}
            calls=[]
            def git(command,**kwargs):
                if command[1:3]==['remote','get-url']:return 'https://github.com/jhlxlml/avhub.git\n'
                if command[1]=='status':return ''
                if command[1]=='rev-parse':return sha+'\n'
                raise AssertionError('CI must not use credential manager or a branch-head check')
            def api(request,**kwargs):
                calls.append((request.method,request.full_url))
                if request.method=='GET':body=draft if request.full_url.endswith('/releases/1') else [draft]
                elif request.method=='DELETE':draft['assets']=[];return io.BytesIO(b'')
                elif request.method=='POST':
                    name=request.full_url.split('name=')[1]
                    body={'name':name,'state':'uploaded','size':len(request.data),'digest':'sha256:'+hashlib.sha256(request.data).hexdigest()};draft['assets'].append(body)
                else:body={'html_url':'https://github.com/jhlxlml/avhub/releases/tag/v1.2.3','draft':False,'tag_name':'v1.2.3'}
                return io.BytesIO(json.dumps(body).encode())
            env={'GITHUB_ACTIONS':'true','GITHUB_REPOSITORY':'jhlxlml/avhub','GITHUB_EVENT_NAME':'push','GITHUB_REF':'refs/tags/v1.2.3','GITHUB_SHA':sha,'GITHUB_TOKEN':'test-token'}
            with patch.object(publisher,'ROOT',root),patch('sys.argv',['publisher','--publish','--ci']),patch.dict(publisher.os.environ,env),patch.object(publisher.subprocess,'check_output',side_effect=git),patch.object(publisher.runpy,'run_path',return_value={'validate_release':lambda tag:None,'verify':lambda *a:None}),patch.object(publisher,'urlopen',side_effect=api),contextlib.redirect_stdout(io.StringIO()):
                publisher.main()
            self.assertIn(('DELETE','https://api.github.com/repos/jhlxlml/avhub/releases/assets/77'),calls)
            self.assertEqual(calls[-1][0],'PATCH')
            self.assertTrue(any('AVHub-folder-portable-1.2.3-x64.zip' in url and method=='POST' for method,url in calls))
            self.assertEqual((root/'dist/electron/SHA256SUMS.txt').read_text(),'two assets verified by mock')

    def test_manual_resume_is_explicit_and_refuses_foreign_or_published_releases(self):
        sha='b'*40;body=publisher.release_body('manual notes','1.2.3',sha,False)
        draft={'draft':True,'prerelease':False,'tag_name':'v1.2.3','target_commitish':sha,'body':body,'assets':[]}
        self.assertIn('avhub-manual-release:'+sha,body)
        self.assertFalse(publisher.reusable_draft(draft,body,sha,False,False,'v1.2.3'))
        self.assertTrue(publisher.reusable_draft(draft,body,sha,False,True,'v1.2.3'))
        for changed in ({'draft':False},{'prerelease':True},{'tag_name':'v1.2.4'},{'target_commitish':'c'*40},{'body':'unowned'},{'body':body+'changed'}):
            self.assertFalse(publisher.reusable_draft(draft|changed,body,sha,False,True,'v1.2.3'))
        self.assertFalse(publisher.reusable_draft(draft,body,sha,True,True,'v1.2.3'))
        with self.assertRaises(SystemExit):publisher.check_draft(draft|{'assets':[{'name':'private.db'}]},body,sha,False,True,[],'v1.2.3')

    def test_remote_assets_require_digest_not_only_a_matching_name_and_size(self):
        with tempfile.TemporaryDirectory() as temporary:
            file=Path(temporary)/'asset.zip';file.write_bytes(b'owned')
            good={'state':'uploaded','size':5,'digest':'sha256:'+hashlib.sha256(b'owned').hexdigest()}
            self.assertTrue(publisher.verified_asset(good,file))
            for changed in ({'state':'starter'},{'size':4},{'digest':None},{'digest':'sha256:'+'0'*64}):
                self.assertFalse(publisher.verified_asset(good|changed,file))

    def test_manual_publisher_reuses_valid_assets_and_rechecks_remote_draft(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);directory=root/'dist/electron';directory.mkdir(parents=True);(root/'docs').mkdir()
            (root/'package.json').write_text('{"version":"1.2.3"}');(root/'docs/RELEASE-1.2.3.md').write_text('notes')
            names=['AVHub-portable-1.2.3-x64.exe','AVHub-folder-portable-1.2.3-x64.zip','SHA256SUMS.txt','release-build.json']
            for name in names:(directory/name).write_bytes(b'owned')
            sha='d'*40;body=publisher.release_body('notes','1.2.3',sha,False)
            asset=lambda name:{'id':100+names.index(name),'name':name,'state':'uploaded','size':5,'digest':'sha256:'+hashlib.sha256(b'owned').hexdigest()}
            draft={'id':2,'tag_name':'v1.2.3','draft':True,'prerelease':False,'target_commitish':sha,'body':body,'assets':[asset(names[0])]};calls=[]
            def git(command,**kwargs):
                if command[1:3]==['remote','get-url']:return 'https://github.com/jhlxlml/avhub.git\n'
                if command[1]=='status':return ''
                if command[1]=='rev-parse':return sha+'\n'
                if 'refs/heads/main' in command:return sha+'\trefs/heads/main\n'
                return sha+'\trefs/tags/v1.2.3^{}\n'
            def api(request,**kwargs):
                calls.append((request.method,request.full_url))
                if request.method=='GET':value=draft if request.full_url.endswith('/releases/2') else [draft]
                elif request.method=='POST':
                    name=request.full_url.split('name=')[1];value=asset(name);draft['assets'].append(value)
                elif request.method=='PATCH':value={'html_url':'https://github.com/jhlxlml/avhub/releases/tag/v1.2.3','draft':False,'tag_name':'v1.2.3'}
                else:raise AssertionError('Valid existing asset must not be deleted')
                return io.BytesIO(json.dumps(value).encode())
            credential=type('Credential',(),{'returncode':0,'stdout':'password=test-only-token\n'})()
            with patch.object(publisher,'ROOT',root),patch('sys.argv',['publisher','--publish','--resume']),patch.object(publisher.subprocess,'run',return_value=credential),patch.object(publisher.subprocess,'check_output',side_effect=git),patch.object(publisher.runpy,'run_path',return_value={'validate_release':lambda tag:None,'verify':lambda *a:None}),patch.object(publisher,'urlopen',side_effect=api),contextlib.redirect_stdout(io.StringIO()):
                publisher.main()
            self.assertEqual(sum(method=='POST' for method,url in calls),3)
            self.assertIn(('GET','https://api.github.com/repos/jhlxlml/avhub/releases/2'),calls)
            self.assertEqual(calls[-1][0],'PATCH')
