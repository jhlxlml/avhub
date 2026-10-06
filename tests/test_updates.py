import json
import unittest
from unittest.mock import patch,MagicMock
from urllib.error import HTTPError,URLError
from fastapi import HTTPException
from app import updates

def published(tag='v0.2.10',asset=True):
    number=tag.lstrip('v');filename=f'AVHub-portable-{number}-x64.exe'
    return {'tag_name':tag,'draft':False,'prerelease':False,'body':'原画播放与更新说明','assets':[{'name':filename,'state':'uploaded','size':100,'browser_download_url':f'{updates.REPOSITORY}/releases/download/{tag}/{filename}'}] if asset else []}
class UpdateTests(unittest.TestCase):
    def test_folder_only_dual_formats_and_wrong_zip_host(self):
        value=published(asset=False);tag=value['tag_name'];filename='AVHub-folder-portable-0.2.10-x64.zip'
        folder={'name':filename,'state':'uploaded','size':12345678,'browser_download_url':f'{updates.REPOSITORY}/releases/download/{tag}/{filename}'}
        value['assets']=[folder]
        info=updates.release_info(value,'0.2.9');self.assertEqual(info['status'],'available');self.assertEqual(info['downloads'][0]['format'],'folder')
        value['assets']+=published()['assets'];self.assertEqual([d['format'] for d in updates.release_info(value,'0.2.9')['downloads']],['folder','single'])
        value['assets']=[{**folder,'browser_download_url':'https://invalid.example/file.zip'}]
        self.assertEqual(updates.release_info(value,'0.2.9')['status'],'pending')
    def test_semantic_versions_and_download_readiness(self):
        self.assertEqual(updates.release_info(published(),'0.2.9')['status'],'available')
        self.assertEqual(updates.release_info(published(asset=False),'0.2.9')['status'],'pending')
        self.assertEqual(updates.release_info(published(),'0.2.10')['status'],'current')
        self.assertEqual(updates.release_info(published(),'0.3.0')['status'],'ahead')
    def test_drafts_prereleases_malformed_tags_and_external_assets(self):
        for field in ('draft','prerelease'):
            release=published();release[field]=True
            with self.assertRaises(ValueError):updates.release_info(release,'0.2.3')
        for tag in ('v0.2.4-beta','v01.2.3','https://malicious.example','v'+'1'*100+'.2.3'):
            with self.assertRaises(ValueError):updates.version(tag)
        release=published();release['assets'][0]['browser_download_url']='https://malicious.example/file.exe'
        self.assertEqual(updates.release_info(release,'0.2.3')['status'],'pending')
    def test_failures_are_not_reported_as_latest(self):
        for code in (404,403,429,500):
            with patch.object(updates,'fetch_release',side_effect=HTTPError(updates.ENDPOINT,code,'',{},None)):
                if code==404:self.assertEqual(updates.check('0.2.3')['status'],'unpublished')
                else:
                    with self.assertRaises(HTTPException):updates.check('0.2.3')
        with patch.object(updates,'fetch_release',side_effect=URLError('offline')):
            with self.assertRaises(HTTPException):updates.check('0.2.3')
    def test_request_has_no_credentials_or_paths_and_bounds_response(self):
        response=MagicMock();response.__enter__.return_value=response;response.geturl.return_value=updates.ENDPOINT
        response.read.return_value=json.dumps(published()).encode()
        with patch.object(updates,'fetch_release',return_value=response) as fetch:
            self.assertEqual(updates.check('0.2.3')['status'],'available')
            request=fetch.call_args.args[0];self.assertEqual(request.full_url,updates.ENDPOINT);self.assertIsNone(request.data);self.assertFalse(request.has_header('Authorization'))
        response.read.return_value=b' '* (512*1024+1)
        with patch.object(updates,'fetch_release',return_value=response):
            with self.assertRaises(HTTPException):updates.check('0.2.3')
