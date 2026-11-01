"""Bind actual dual-MPV tests and corresponding sources to ordinary packaging.

No executable/runtime download, implicit approval flag, packaging or publication.
"""
import argparse
import hashlib
import json
import subprocess
import tempfile
import zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory',type=Path,required=True)
    parser.add_argument('--independent-test',type=Path,required=True)
    parser.add_argument('--coexistence-test',type=Path,required=True)
    parser.add_argument('--render-test',type=Path,required=True)
    args=parser.parse_args()

    def owned(file):
        file=file.resolve()
        if not file.is_relative_to((ROOT/'build').resolve()) or not file.is_file() or file.is_symlink():
            raise ValueError('Owned evidence file required')
        return file

    def item(file):
        file=owned(file)
        return {'path':file.relative_to(ROOT).as_posix(),'sha256':hashlib.file_digest(file.open('rb'),'sha256').hexdigest()}

    binding=json.loads(owned(args.directory/'M5-BUILD-INPUTS.json').read_text(encoding='utf-8'))
    target=subprocess.run(['node',str(ROOT/'electron/release-evidence.cjs'),'target',str(ROOT),str(owned(args.directory/'M5-BUILD-INPUTS.json'))],capture_output=True,text=True,encoding='utf-8')
    if target.returncode:raise ValueError('Current application acceptance required: '+target.stderr.strip())
    expected=json.loads(target.stdout)
    mpv=ROOT/binding['independentRuntime']; manifest=json.loads(owned(mpv/'runtime.json').read_text(encoding='utf-8'))
    native=ROOT/binding['nativeRoot']
    independent=json.loads(owned(args.independent_test).read_text(encoding='utf-8'))
    coexistence=json.loads(owned(args.coexistence_test).read_text(encoding='utf-8'))
    render=json.loads(owned(args.render_test).read_text(encoding='utf-8'))
    if (not independent.get('completed') or not independent.get('cleanExit') or not independent.get('sourceUnchanged')
        or independent.get('runtime',{}).get('exeSha256')!=manifest['exeSha256']
        or not coexistence.get('passed') or not coexistence.get('cleanExit')
        or coexistence.get('runtimeExeSha256')!=manifest['exeSha256'] or not render.get('passed') or not render.get('packaged')):
        raise ValueError('Matching actual packaged dual-MPV acceptance required')
    source=json.loads((ROOT/'build/m5-source-delivery.json').read_text(encoding='utf-8'))
    if not source['allMembersVerified'] or source['nativeSourceArchives']!=22 or not Path(source['zip']).resolve().is_relative_to(args.directory.resolve()):
        raise ValueError('Current complete source delivery required')
    archive=owned(Path(source['zip']))
    if item(archive)['sha256']!=source['sha256']:raise ValueError('Source archive bytes changed')
    with zipfile.ZipFile(archive) as bundle:
        index=json.loads(bundle.read('DELIVERY-INDEX.json'))
        identity=json.loads(bundle.read('APPLICATION/app/build-info.json'))
        if identity['version']!=expected['version'] or identity['build_id']!=expected['buildId']:raise ValueError('Source ZIP application version/build differs')
        names=bundle.namelist()
        if len(names)!=len(set(names)):raise ValueError('Duplicate source archive members')
        for member in index['files']:
            with bundle.open(member['path']) as stream:
                if hashlib.file_digest(stream,'sha256').hexdigest()!=member['sha256']:raise ValueError('Source archive member changed: '+member['path'])
        members={member['path']:member['sha256'] for member in index['files']}
        for name,digest in expected['sourceFiles']:
            if members.get('APPLICATION/'+name)!=digest:raise ValueError('Current source differs from delivered ZIP: '+name)
    result={'schema':2,'kind':'avhub-dual-mpv-release-inputs',
            'binding':item(args.directory/'M5-BUILD-INPUTS.json'),
            'application':{key:value for key,value in expected.items() if key!='sourceFiles'},
            'acceptedApplication':{'exeSha256':independent.get('subject',{}).get('applicationExeSha256'),'asarSha256':independent.get('subject',{}).get('applicationAsarSha256')},
            'render':item(native/'runtime.json'),'independent':item(mpv/'runtime.json'),
            'sourceBundle':item(Path(source['zip'])),
            'acceptance':[{'role':role,**item(file)} for role,file in [('independent',args.independent_test),('coexistence',args.coexistence_test),('render',args.render_test)]],
            'scope':'Windows x64 desktop; display/HDR/mixed-DPI limits recorded, not playback admission',
            'publicationReady':False,'hostedCi':'BLOCKED until matching current-commit Windows CI succeeds','published':False}
    with tempfile.NamedTemporaryFile(mode='w',encoding='utf-8',prefix='desktop-release-validation-',suffix='.json',dir=ROOT/'build',delete=False) as candidate:
        json.dump(result,candidate,indent=2);validation=Path(candidate.name)
    check=subprocess.run(['node',str(ROOT/'electron/release-evidence.cjs'),'verify',str(ROOT),str(validation)],capture_output=True,text=True,encoding='utf-8')
    if check.returncode:raise ValueError('Actual same-application packaged proof required: '+check.stderr.strip())
    destination=ROOT/'build/desktop-release-inputs.json'
    destination.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(str(destination))


if __name__=='__main__':
    main()
