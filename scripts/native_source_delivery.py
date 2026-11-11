"""Exact native source/patch membership shared by staging and release checks.

These contracts validate provenance membership, not licensing or GPU behavior.
"""
import hashlib
import json


def native_inputs(materials, render, independent):
    subject = materials['subject']
    if subject['id'] != render['cohort'] or subject['dllSha256'] != render['dllSha256']:
        raise ValueError('Native source dossier belongs to another runtime')
    sources = [*materials['sourceArchives'], independent['luaSource']]
    ids = [item['id'] for item in sources]
    paths = [item['archive'] for item in sources]
    if len(ids) != len(set(ids)) or len(paths) != len(set(paths)):
        raise ValueError('Duplicate native source identity')
    mpv = next(item for item in sources if item['id'] == 'mpv')
    if (mpv['revision'] != subject['sourceRevision'] or mpv['revision'] != independent['sourceCommit']
            or mpv['archiveSha256'] != independent['sourceArchiveSha256']):
        raise ValueError('Independent and embedded MPV source identities differ')
    if subject.get('patches', []) != independent.get('patches', []):
        raise ValueError('Independent and embedded MPV patch identities differ')
    return sorted([{'id':item['id'], 'revision':item['revision'], 'path':'NATIVE/'+item['archive'],
                    'sha256':item['archiveSha256']} for item in sources], key=lambda item:item['id'])


def validate_native_members(index, materials, render, independent):
    expected = native_inputs(materials, render, independent)
    if index.get('nativeSourceInputs') != expected or index.get('nativeSourceArchives') != len(expected):
        raise ValueError('Exact native source inventory required; counts alone are insufficient')
    members = {item['path']:item['sha256'] for item in index['files']}
    if len(members) != len(index['files']):
        raise ValueError('Duplicate source delivery member')
    required = [(item['path'],item['sha256']) for item in expected]
    required.extend(('NATIVE/'+item['path'],item['sha256']) for item in materials['subject'].get('patches', []))
    for name, digest in required:
        if members.get(name) != digest:
            raise ValueError('Missing or mismatched native source/patch: '+name)
    return expected


def validate_build_records(materials, render, independent, record):
    if (record.get('buildPassed') is not True or record['recipeSha256'] != independent['recipeSha256']
            or record.get('patches', []) != independent.get('patches', [])):
        raise ValueError('Independent source build receipt differs')
    if 'compatibilityBuild' in materials:
        compatibility = materials['compatibilityBuild']
        if (compatibility.get('buildPassed') is not True or compatibility['dllSha256'] != render['dllSha256']
                or compatibility['patchSha256'] != independent['patches'][0]['sha256']
                or sorted(compatibility['sourceFiles'],key=lambda item:item['name']) != sorted(record['patchedSources'],key=lambda item:item['name'])):
            raise ValueError('Patched source/build identities differ between MPV runtimes')


def verify_native_bundle(bundle, index, render_bytes=None, independent_bytes=None):
    """Verify actual ZIP bytes, optionally bound to the selected runtime pair."""
    names = bundle.namelist()
    if len(names) != len(set(names)):
        raise ValueError('Duplicate source archive members')
    render = bundle.read('RENDER/runtime.json')
    independent = bundle.read('INDEPENDENT/runtime.json')
    if (render_bytes is not None and render != render_bytes) or (independent_bytes is not None and independent != independent_bytes):
        raise ValueError('Delivered runtime manifests differ from selected package inputs')
    expected = {item['path'] for item in index['files']}
    if set(names) != expected | {'DELIVERY-INDEX.json', 'README-SOURCE.txt'}:
        raise ValueError('Source ZIP has missing or unindexed members')
    for item in index['files']:
        with bundle.open(item['path']) as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != item['sha256']:
                raise ValueError('Source archive member changed: '+item['path'])
    materials = json.loads(bundle.read('RENDER/materials.json'))
    manifest = json.loads(independent)
    validate_native_members(index, materials, json.loads(render), manifest)
    record = json.loads(bundle.read('INDEPENDENT/build-records/report.json'))
    validate_build_records(materials, json.loads(render), manifest, record)
    members = {item['path']:item['sha256'] for item in index['files']}
    if members.get('INDEPENDENT/scripts/build-desktop-mpv.py') != record['recipeSha256']:
        raise ValueError('Independent build recipe missing or changed')
