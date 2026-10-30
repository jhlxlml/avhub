"""Resolve reported Git suffixes from selected upstreams; never pick HEAD."""
import json,re
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.error import HTTPError,URLError

ROOT=Path(__file__).resolve().parents[1]
REPOSITORIES={
 'AMF':'GPUOpen-LibrariesAndSDKs/AMF','AviSynthPlus':'AviSynth/AviSynthPlus',
 'ffnvcodec':'FFmpeg/nv-codec-headers','fribidi':'fribidi/fribidi',
 'harfbuzz':'harfbuzz/harfbuzz','libass':'libass/libass','libwebp':'webmproject/libwebp',
 'openal-soft':'kcat/openal-soft','opus':'xiph/opus','SDL':'libsdl-org/SDL',
 'speex':'xiph/speex','srt':'Haivision/srt','vidstab':'georgmartius/vid.stab',
 'vmaf':'Netflix/vmaf','vorbis':'xiph/vorbis','vpx':'webmproject/libvpx','zimg':'sekrit-twc/zimg',
}

def resolve():
    target=ROOT/'ci/ffmpeg-external-sources.json';pin=json.loads(target.read_text(encoding='utf-8'))
    info=(ROOT/'bin/FFmpeg-BUILD-INFO.txt').read_text(encoding='utf-8').split("release-essentials external libraries' versions:",1)[1]
    versions=dict(line.split(maxsplit=1) for line in info.splitlines() if line.strip())
    existing={x['name'] for x in pin['libraries']};resolved=[];unresolved=[]
    for name,repository in REPOSITORIES.items():
        if name in existing:continue
        version=versions[name];match=re.search(r'-g([0-9a-f]{7,12})$',version)
        if match is None:unresolved.append({'name':name,'reason':'No exact Git suffix'});continue
        prefix=match[1]
        try:
            request=Request('https://api.github.com/repos/'+repository+'/commits/'+prefix,headers={'User-Agent':'AVHub-source-review'})
            with urlopen(request,timeout=20) as response:commit=json.load(response)
            revision=commit['sha']
            if not re.fullmatch('[0-9a-f]{40}',revision) or not revision.startswith(prefix):raise ValueError('Resolved commit differs')
            tree_url='https://api.github.com/repos/'+repository+'/git/trees/'+commit['commit']['tree']['sha']
            with urlopen(Request(tree_url,headers={'User-Agent':'AVHub-source-review'}),timeout=20) as response:tree=json.load(response)
            names={node['path'] for node in tree['tree'] if node['type']=='blob'}
            candidates=['COPYING','LICENSE','LICENSE.md','LICENSE.txt','LICENSE.TXT','COPYING.txt','COPYING.md','LICENSE.md.txt']
            license_file=next((candidate for candidate in candidates if candidate in names),None)
            if license_file is None:unresolved.append({'name':name,'reason':'No recognized root license; manual review required'});continue
            item={'name':name,'reportedVersion':version,'repository':'https://github.com/'+repository+'.git','revision':revision,'reportedCommitPrefix':prefix,'license':license_file}
            resolved.append(item)
        except (HTTPError,URLError,TimeoutError) as error:unresolved.append({'name':name,'reason':str(error)})
    pin['scope']='Upstream source review for selected existing static CLI dependencies, not complete corresponding-source certification'
    pin['libraries']+=resolved
    target.write_text(json.dumps(pin,indent=2)+'\n',encoding='utf-8')
    (ROOT/'build/ffmpeg-source-pin-resolution.json').write_text(json.dumps({'resolved':resolved,'unresolved':unresolved,'vendorCorrespondenceComplete':False},indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'newPins':len(resolved),'totalPins':len(pin['libraries']),'unresolved':unresolved}))

if __name__=='__main__':resolve()
