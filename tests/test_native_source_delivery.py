"""Synthetic membership/ZIP contracts. Never certifies native builds or playback."""
import copy
import hashlib
import io
import json
from pathlib import Path
import sys
import unittest
import zipfile

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from native_source_delivery import native_inputs, validate_native_members, verify_native_bundle


def source_fixture():
    digest=lambda value:hashlib.sha256(value).hexdigest()
    patch=b'synthetic patch';recipe=b'# synthetic build recipe'
    sources=[{'id':name,'revision':'fixture-'+name,'archive':'build/'+name+'.tar','archiveSha256':digest(name.encode())} for name in ('mpv','dependency')]
    patches=[{'path':'ci/patches/fixture.patch','sha256':digest(patch)}]
    subject={'id':'fixture-cohort','dllSha256':'a'*64,'sourceRevision':'fixture-mpv','patches':patches}
    changed=[{'name':'demux/test.c','before':'b'*64,'after':'c'*64}]
    materials={'subject':subject,'sourceArchives':sources,'compatibilityBuild':{'buildPassed':True,'dllSha256':'a'*64,'patchSha256':digest(patch),'sourceFiles':changed}}
    render={'cohort':subject['id'],'dllSha256':subject['dllSha256']}
    lua={'id':'luajit','revision':'fixture-lua','archive':'build/lua.tar','archiveSha256':digest(b'lua')}
    independent={'schema':1,'sourceCommit':'fixture-mpv','sourceArchiveSha256':sources[0]['archiveSha256'],'patches':patches,'luaSource':lua,'recipeSha256':digest(recipe),
                 'exeSha256':digest(b'MZ-independent'),'licenseSha256':digest(b'GPL fixture'),'dependencies':[]}
    record={'buildPassed':True,'recipeSha256':digest(recipe),'patches':patches,'patchedSources':changed}
    members={**{'NATIVE/'+item['archive']:item['id'].encode() for item in sources},'NATIVE/build/lua.tar':b'lua',
             'NATIVE/ci/patches/fixture.patch':patch,'INDEPENDENT/scripts/build-desktop-mpv.py':recipe,
             'RENDER/materials.json':json.dumps(materials).encode(),'RENDER/runtime.json':json.dumps(render).encode(),
             'INDEPENDENT/runtime.json':json.dumps(independent).encode(),'INDEPENDENT/build-records/report.json':json.dumps(record).encode()}
    index={'applicationBuild':{'version':'1.2.3','build_id':'test-build'},'nativeSourceArchives':3,'controlledCliSourceArchives':11,
           'nativeSourceInputs':native_inputs(materials,render,independent),
           'files':[{'path':name,'sha256':digest(data)} for name,data in members.items()]}
    return members,index,materials,render,independent


def source_zip(members,index):
    stream=io.BytesIO()
    with zipfile.ZipFile(stream,'w') as bundle:
        for name,data in members.items():bundle.writestr(name,data)
        bundle.writestr('DELIVERY-INDEX.json',json.dumps(index));bundle.writestr('README-SOURCE.txt','Synthetic source contract')
    stream.seek(0)
    return zipfile.ZipFile(stream)


class NativeDeliveryContracts(unittest.TestCase):
    def test_actual_member_hashes_and_bound_runtime_manifests(self):
        members,index,materials,render,independent=source_fixture()
        with source_zip(members,index) as bundle:
            verify_native_bundle(bundle,index,members['RENDER/runtime.json'],members['INDEPENDENT/runtime.json'])
            with self.assertRaisesRegex(ValueError,'selected package inputs'):
                verify_native_bundle(bundle,index,b'other runtime',members['INDEPENDENT/runtime.json'])

    def test_same_count_wrong_archive_or_missing_patch_is_rejected(self):
        members,index,materials,render,independent=source_fixture()
        for change in ('archive','patch','count-only','duplicate'):
            altered=copy.deepcopy(index)
            if change=='archive':altered['nativeSourceInputs'][0]['sha256']='0'*64
            if change=='patch':altered['files']=[item for item in altered['files'] if not item['path'].endswith('.patch')]
            if change=='count-only':del altered['nativeSourceInputs']
            if change=='duplicate':altered['files'].append(altered['files'][0])
            with self.subTest(change=change),self.assertRaises(ValueError):validate_native_members(altered,materials,render,independent)

    def test_wrong_cohort_mpv_source_or_patch_is_rejected(self):
        members,index,materials,render,independent=source_fixture()
        for value in ({**independent,'sourceCommit':'other'},{**independent,'patches':[]},{**independent,'sourceArchiveSha256':'0'*64}):
            with self.assertRaises(ValueError):native_inputs(materials,render,value)
        with self.assertRaises(ValueError):native_inputs(materials,{**render,'cohort':'other'},independent)

    def test_unindexed_or_corrupt_zip_member_is_rejected(self):
        members,index,*_=source_fixture()
        for changed in ({**members,'extra.txt':b'unindexed'},{**members,'NATIVE/build/mpv.tar':b'corrupt'}):
            with source_zip(changed,index) as bundle,self.assertRaises(ValueError):verify_native_bundle(bundle,index)

    def test_same_recipe_with_different_patched_sources_is_rejected(self):
        members,index,*_=source_fixture();record=json.loads(members['INDEPENDENT/build-records/report.json']);record['patchedSources'][0]['after']='0'*64
        data=json.dumps(record).encode();members['INDEPENDENT/build-records/report.json']=data
        next(item for item in index['files'] if item['path']=='INDEPENDENT/build-records/report.json')['sha256']=hashlib.sha256(data).hexdigest()
        with source_zip(members,index) as bundle,self.assertRaisesRegex(ValueError,'Patched source'):verify_native_bundle(bundle,index)

    def test_missing_recipe_cannot_pass_by_updating_the_zip_index(self):
        members,index,*_=source_fixture()
        name='INDEPENDENT/scripts/build-desktop-mpv.py';del members[name]
        index['files']=[item for item in index['files'] if item['path']!=name]
        with source_zip(members,index) as bundle,self.assertRaisesRegex(ValueError,'recipe missing'):
            verify_native_bundle(bundle,index)
