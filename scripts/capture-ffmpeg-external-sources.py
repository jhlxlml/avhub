"""Capture fixed upstream revisions; never infer a complete vendor source closure."""
import hashlib,json,re,shutil,subprocess,tarfile,tempfile,sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]

def capture():
    pin=json.loads((ROOT/'ci/ffmpeg-external-sources.json').read_text(encoding='utf-8'))
    info=(ROOT/'bin/FFmpeg-BUILD-INFO.txt').read_text(encoding='utf-8')
    footer=info.split("release-essentials external libraries' versions:",1)[1]
    reported=dict(line.split(maxsplit=1) for line in footer.splitlines() if line.strip())
    if shutil.disk_usage(ROOT/'build').free<1024**3:raise OSError('Source review requires 1GiB free')
    previous=ROOT/'build/ffmpeg-external-source-review-latest.json';prior_folder=None;prior={}
    if previous.exists():
        prior_folder=Path(json.loads(previous.read_text(encoding='utf-8'))['folder'])
        if not prior_folder.resolve().is_relative_to((ROOT/'build').resolve()):raise ValueError('Previous review must be owned')
        prior={item['name']:item for item in json.loads((prior_folder/'report.json').read_text(encoding='utf-8'))['members']}
    extend='--extend-current' in sys.argv
    if extend and (prior_folder is None or not prior_folder.name.startswith('ffmpeg-external-source-review-')):raise ValueError('Owned current capture required')
    if '--resume' in sys.argv:
        folder=Path(sys.argv[sys.argv.index('--resume')+1]).resolve()
        if not folder.is_relative_to((ROOT/'build').resolve()) or not folder.name.startswith('ffmpeg-external-source-review-') or not folder.is_dir():raise ValueError('Owned unfinished capture required')
        if (folder/'report.json').exists():
            prior_folder=folder;prior={item['name']:item for item in json.loads((folder/'report.json').read_text(encoding='utf-8'))['members']}
    else:folder=prior_folder if extend else Path(tempfile.mkdtemp(prefix='ffmpeg-external-source-review-',dir=ROOT/'build'))
    receipt={'schema':1,'scope':pin['scope'],'members':[],'allExternalLibrariesCovered':False,'vendorPatchesAndBuildRecipesVerified':False,'binaryReproduced':False,'distributionReady':False}
    if extend:receipt['incrementallyExtended']=True;receipt['previousMemberCount']=len(prior)
    for item in pin['libraries']:
        if reported.get(item['name'])!=item['reportedVersion'] or not re.fullmatch('[0-9a-f]{40}',item['revision']):raise ValueError('Reported source identity differs')
        old=prior.get(item['name'])
        if old and old['revision']==item['revision'] and old['reportedVersion']==item['reportedVersion']:
            original=prior_folder/old['archive']
            if original.parent!=prior_folder or hashlib.sha256(original.read_bytes()).hexdigest()!=old['archiveSha256']:raise ValueError('Previous source archive changed')
            if folder!=prior_folder:shutil.copyfile(original,folder/original.name)
            license_file=prior_folder/(item['name']+'-COPYING.txt')
            with tarfile.open(original) as source:
                if source.extractfile(item['name']+'/'+item['license']).read()!=license_file.read_bytes():raise ValueError('Previous license source changed')
            if folder!=prior_folder:shutil.copyfile(license_file,folder/license_file.name)
            if 'runtimePrefix' in item:
                encoded=prior_folder/old['syntheticBitstream']
                if encoded.parent!=prior_folder or hashlib.sha256(encoded.read_bytes()).hexdigest()!=old['syntheticBitstreamSha256']:raise ValueError('Previous encoder evidence changed')
                if folder!=prior_folder:shutil.copyfile(encoded,folder/encoded.name)
                log=prior_folder/(item['name']+'-synthetic-encoder.log')
                if folder!=prior_folder:shutil.copyfile(log,folder/log.name)
            receipt['members'].append(old if folder==prior_folder else {**old,'sourceReusedFrom':str(prior_folder)})
            continue
        if extend and old:raise ValueError('Changed dependency requires a separate source review')
        repository=folder/(item['name']+'.git')
        if not repository.exists():subprocess.run(['git','init','--bare',str(repository)],capture_output=True,check=True)
        cached=subprocess.run(['git','-C',str(repository),'cat-file','-e',item['revision']],capture_output=True)
        if cached.returncode:
            subprocess.run(['git','-c','credential.interactive=never','-C',str(repository),'fetch','--depth=1',*(['--filter=blob:limit=10m'] if item.get('archivePaths') else []),item['repository'],item['revision']],capture_output=True,check=True,timeout=120)
        actual=subprocess.check_output(['git','-C',str(repository),'rev-parse',item['revision']],text=True).strip()
        if actual!=item['revision']:raise ValueError('Fetched dependency differs')
        if 'reportedCommitPrefix' in item and not actual.startswith(item['reportedCommitPrefix']):raise ValueError('Reported commit prefix differs')
        archive=folder/(item['name']+'-'+actual+'.tar')
        subprocess.run(['git','-C',str(repository),'archive','--format=tar','--prefix='+item['name']+'/','--output='+str(archive),actual,*item.get('archivePaths',[])],check=True,timeout=60)
        if archive.stat().st_size>256*1024**2:raise ValueError('Dependency archive exceeds source-review bound')
        with tarfile.open(archive) as source:
            license_bytes=source.extractfile(item['name']+'/'+item['license']).read()
            if not license_bytes.strip():raise ValueError('Missing dependency license')
        (folder/(item['name']+'-COPYING.txt')).write_bytes(license_bytes)
        row={**item,'archive':archive.name,'archiveBytes':archive.stat().st_size,'archiveSha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'upstreamArchiveVerified':True,'vendorPatchesVerified':False}
        tree=subprocess.check_output(['git','-C',str(repository),'ls-tree','-rz',actual])
        row['submoduleTargets']=[entry.decode('utf-8') for entry in tree.split(b'\0') if entry.startswith(b'160000 ')]
        row['submoduleContentsIncluded']=not row['submoduleTargets']
        if 'runtimePrefix' in item:
            codec='lib'+item['name'];command=[str(ROOT/'bin/ffmpeg.exe'),'-hide_banner','-f','lavfi','-i','color=s=64x64:r=1','-frames:v','1','-c:v',codec]
            if item['name']=='x265':command+=['-x265-params','pools=none:frame-threads=1']
            command+=['-f','h264' if item['name']=='x264' else 'hevc','pipe:1']
            result=subprocess.run(command,capture_output=True,check=True,timeout=20)
            if item['runtimePrefix'].encode() not in result.stdout+result.stderr:raise ValueError('Actual synthetic encoder probe reports another revision')
            row['syntheticEncoderRevisionObserved']=True
            (folder/(item['name']+'-synthetic-encoder.log')).write_bytes(result.stderr)
            encoded=folder/(item['name']+'-synthetic.'+('h264' if item['name']=='x264' else 'hevc'))
            encoded.write_bytes(result.stdout);row['syntheticBitstream']=encoded.name;row['syntheticBitstreamSha256']=hashlib.sha256(result.stdout).hexdigest()
        receipt['members'].append(row)
        (folder/'report.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
    receipt['reportedExternalLibraryCount']=len(reported)
    receipt['notYetArchived']=[name for name in reported if name not in {x['name'] for x in receipt['members']}]
    receipt['ffmpegSha256']=hashlib.sha256((ROOT/'bin/ffmpeg.exe').read_bytes()).hexdigest()
    (folder/'report.json').write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
    (ROOT/'build/ffmpeg-external-source-review-latest.json').write_text(json.dumps({'folder':str(folder),'upstreamArchivesVerified':len(receipt['members']),'distributionReady':False},indent=2)+'\n',encoding='utf-8')
    print(folder)

if __name__=='__main__':capture()
