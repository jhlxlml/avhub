"""Read-only source input audit; no dossier copies, ZIPs or release approval."""
import hashlib
import json
from pathlib import Path
import runpy
from native_source_delivery import native_inputs, validate_build_records

ROOT=Path(__file__).resolve().parents[1]


def audit(root=ROOT):
    native=runpy.run_path(str(root/'scripts/stage-native-source-materials.py'))['stage'](root,replayed=True,audit_only=True)
    candidate=Path(native['candidate'])
    materials=json.loads((candidate/'materials.json').read_text(encoding='utf-8'))
    render=json.loads((candidate/'runtime.json').read_text(encoding='utf-8'))
    pin=json.loads((root/'ci/mkv-index-render-runtime.json').read_text(encoding='utf-8'))
    if materials['subject']!=pin or render['cohort']!=pin['id']:
        raise ValueError('Selected native materials differ from compatibility pin')
    pointer=json.loads((root/'build/desktop-mpv-runtime-latest.json').read_text(encoding='utf-8'))
    independent_root=Path(pointer['folder'])
    if independent_root.resolve().parent!=(root/'build').resolve() or not independent_root.name.startswith('mpv-desktop-runtime-'):
        raise ValueError('Owned staged independent runtime required')
    independent=json.loads((independent_root/'runtime.json').read_text(encoding='utf-8'))
    files={item['path']:item for item in native['files']}

    def verify(file, expected=None):
        file=file.absolute()
        if not file.is_relative_to(root) or not file.is_file() or file.resolve()!=file or file.is_symlink():
            raise ValueError('Owned regular source material required')
        with file.open('rb') as stream:digest=hashlib.file_digest(stream,'sha256').hexdigest()
        if expected is not None and digest!=expected:
            raise ValueError('Source material changed: '+str(file.relative_to(root)))
        name=file.relative_to(root).as_posix()
        files[name]={'path':name,'sha256':digest,'size':file.stat().st_size}

    inputs=native_inputs(materials,render,independent)
    for item in inputs:
        relative=item['path'].removeprefix('NATIVE/')
        if relative in files:
            if files[relative]['sha256']!=item['sha256']:raise ValueError('Native input hash differs')
        else:verify(root/relative,item['sha256'])
    record_file=Path(independent['buildReceipt']);verify(record_file)
    record=json.loads(record_file.read_text(encoding='utf-8'))
    validate_build_records(materials,render,independent,record)
    verify(root/'scripts/build-desktop-mpv.py',record['recipeSha256'])
    verify(root/'scripts/stage-desktop-mpv.py')
    lua=root/independent['luaSource']['archive']
    verify(independent_root/'materials/desktop-sources'/lua.name,independent['luaSource']['archiveSha256'])
    for item in independent['patches']:
        verify(root/item['path'],item['sha256'])
        verify(independent_root/'materials/desktop-sources'/Path(item['path']).name,item['sha256'])
    dossier=Path(json.loads((root/'build/native-replayed-source-materials-latest.json').read_text(encoding='utf-8'))['folder'])
    prior=json.loads((dossier/'inventory.json').read_text(encoding='utf-8'))
    return {'schema':1,'scope':'read-only-source-input-audit-not-source-package-or-legal-certification',
            'passed':True,'cohort':render['cohort'],'nativeCandidate':str(candidate),'independentCandidate':str(independent_root),
            'nativeSourceInputs':inputs,'sourceArchives':len(inputs),'files':list(files.values()),
            'totalBytesVerified':sum(item['size'] for item in files.values()),'copiedBytes':0,'distributionReady':False,
            'existingDossierMatchesSelected':prior['cohort']==render['cohort'],
            'remaining':['Regenerate source dossier for selected cohort when preparing authorized package',
                         'New frozen application/backend replay, source ZIP and exact packaged acceptance still required']}


if __name__=='__main__':print(json.dumps(audit(),indent=2))
