import importlib.util
import json
import io
import contextlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import yaml
ROOT=Path(__file__).resolve().parents[1]
def module(name,file):
    spec=importlib.util.spec_from_file_location(name,ROOT/file);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
prepare=module('ci_prepare','scripts/ci-prepare.py');artifacts=module('ci_artifacts','scripts/ci-artifacts.py')
publisher=module('ci_publisher','scripts/publish-release.py')
class CITests(unittest.TestCase):
    def test_tag_matches_metadata_and_requires_release_notes(self):
        version=json.loads((ROOT/'package.json').read_text())['version']
        self.assertEqual(prepare.validate_release('v'+version),version)
        with self.assertRaises(ValueError):prepare.validate_release('v0.0.0')
    def test_workflow_has_minimal_permissions_and_pins_actions(self):
        workflow=yaml.load((ROOT/'.github/workflows/windows.yml').read_text(),Loader=yaml.BaseLoader)
        self.assertEqual(workflow['permissions']['contents'],'read')
        self.assertEqual(workflow['jobs']['publish']['permissions']['contents'],'write')
        self.assertIn("github.event_name == 'push'",workflow['jobs']['publish']['if'])
        self.assertIn("github.repository == 'jhlxlml/avhub'",workflow['jobs']['publish']['if'])
        for job in workflow['jobs'].values():
            for step in job['steps']:
                if 'uses' in step:self.assertRegex(step['uses'],r'@([a-f0-9]{40})$')
                if step.get('name')=='Package only tags or explicit manual runs':self.assertIn('workflow_dispatch',step['if'])
    def test_manifest_rejects_corruption_or_different_source(self):
        with tempfile.TemporaryDirectory() as directory:
            directory=Path(directory);file=directory/'AVHub-portable-1.2.3-x64.exe';file.write_bytes(b'MZ-test')
            info={'version':'1.2.3','commit':'a'*40,'filename':file.name,'bytes':file.stat().st_size,'sha256':artifacts.digest(file)}
            (directory/'release-build.json').write_text(json.dumps(info));(directory/'SHA256SUMS.txt').write_text(f"{info['sha256']}  {file.name}\n")
            self.assertEqual(artifacts.verify(directory,'1.2.3','a'*40),info)
            with self.assertRaises(ValueError):artifacts.verify(directory,'1.2.3','b'*40)
            file.write_bytes(b'MZ-bad')
            with self.assertRaises(ValueError):artifacts.verify(directory,'1.2.3','a'*40)
    def test_ci_publisher_resumes_only_its_draft_and_handles_empty_delete_responses(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'dist/electron').mkdir(parents=True);(root/'docs').mkdir()
            (root/'package.json').write_text('{"version":"1.2.3"}')
            (root/'docs/RELEASE-1.2.3.md').write_text('notes')
            (root/'dist/electron/AVHub-portable-1.2.3-x64.exe').write_bytes(b'MZ-test')
            (root/'dist/electron/release-build.json').write_text('{}')
            sha='a'*40;draft={'id':1,'tag_name':'v1.2.3','draft':True,'target_commitish':sha,'body':f'notes\n<!-- avhub-ci-release:{sha} -->','assets':[{'id':77,'name':'AVHub-portable-1.2.3-x64.exe','state':'uploaded','size':1,'digest':'wrong'}]}
            calls=[]
            def git(command,**kwargs):
                if command[1:3]==['remote','get-url']:return 'https://github.com/jhlxlml/avhub.git\n'
                if command[1]=='status':return ''
                if command[1]=='rev-parse':return sha+'\n'
                raise AssertionError('CI must not use credential manager or a branch-head check')
            def api(request,**kwargs):
                calls.append((request.method,request.full_url))
                if request.method=='GET':body=[draft]
                elif request.method=='DELETE':return io.BytesIO(b'')
                elif request.method=='POST':body={'state':'uploaded','size':len(request.data)}
                else:body={'html_url':'https://github.com/jhlxlml/avhub/releases/tag/v1.2.3'}
                return io.BytesIO(json.dumps(body).encode())
            env={'GITHUB_ACTIONS':'true','GITHUB_REPOSITORY':'jhlxlml/avhub','GITHUB_EVENT_NAME':'push','GITHUB_REF':'refs/tags/v1.2.3','GITHUB_SHA':sha,'GITHUB_TOKEN':'test-token'}
            with patch.object(publisher,'ROOT',root),patch('sys.argv',['publisher','--publish','--ci']),patch.dict(publisher.os.environ,env),patch.object(publisher.subprocess,'check_output',side_effect=git),patch.object(publisher.runpy,'run_path',return_value={'validate_release':lambda tag:None,'verify':lambda *a:None}),patch.object(publisher,'urlopen',side_effect=api),contextlib.redirect_stdout(io.StringIO()):
                publisher.main()
            self.assertIn(('DELETE','https://api.github.com/repos/jhlxlml/avhub/releases/assets/77'),calls)
            self.assertEqual(calls[-1][0],'PATCH')
