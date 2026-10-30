"""Bind actual dual-MPV tests and corresponding sources to ordinary packaging.

No executable/runtime download, implicit approval flag, packaging or publication.
"""
import argparse
import hashlib
import json
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
    result={'schema':1,'kind':'avhub-dual-mpv-release-inputs',
            'render':item(native/'runtime.json'),'independent':item(mpv/'runtime.json'),
            'sourceBundle':item(Path(source['zip'])),
            'acceptance':[item(args.independent_test),item(args.coexistence_test),item(args.render_test)],
            'scope':'Windows x64 desktop; display/HDR/mixed-DPI limits recorded, not playback admission',
            'published':False}
    destination=ROOT/'build/desktop-release-inputs.json'
    destination.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(str(destination))


if __name__=='__main__':
    main()
