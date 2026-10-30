"""Capture the separately bundled CLI source without replacing any runtime.

The publisher statically links external libraries. This captures upstream
FFmpeg plus observed build/version evidence, not a complete static-link source
closure or binary-reproducibility/legal certification.
"""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

ROOT=Path(__file__).resolve().parents[1]


def capture(root=ROOT):
    pin=json.loads((root/'ci/ffmpeg-cli-source.json').read_text())
    binary=json.loads((root/'ci/ffmpeg.json').read_text())
    info=(root/'bin/FFmpeg-BUILD-INFO.txt').read_text()
    if pin['version']!=binary['version'] or pin['binaryArchiveSha256']!=binary['sha256'] or ('/commit/'+pin['revision'][:10]) not in info:
        raise ValueError('CLI binary/source pin and publisher build info differ')
    if shutil.disk_usage(root/'build').free<1024**3:raise OSError('Insufficient source archive review space')
    destination=Path(tempfile.mkdtemp(prefix='ffmpeg-cli-source-review-',dir=root/'build'));repo=destination/'upstream.git'
    subprocess.run(['git','init','--bare',str(repo)],check=True,capture_output=True)
    subprocess.run(['git','-C',str(repo),'fetch','--depth=1',pin['repository'],pin['revision']],check=True,capture_output=True,timeout=180)
    revision=subprocess.check_output(['git','-C',str(repo),'rev-parse','FETCH_HEAD'],text=True).strip()
    if revision!=pin['revision']:raise ValueError('Fetched CLI source revision differs')
    archive=destination/('ffmpeg-cli-'+revision+'.tar')
    subprocess.run(['git','-C',str(repo),'archive','--format=tar','--prefix=FFmpeg/','--output='+str(archive),revision],check=True,timeout=60)
    if archive.stat().st_size>512*1024**2:raise ValueError('CLI source archive exceeds limit')
    with tarfile.open(archive) as source:
        if source.extractfile('FFmpeg/RELEASE').read().decode().strip()!=pin['version']:raise ValueError('Archived FFmpeg release differs')
        for name in ['COPYING.GPLv3','LICENSE.md','configure']:
            if not source.extractfile('FFmpeg/'+name).read().strip():raise ValueError('Source build/license input missing')
    footer=info.split("release-essentials external libraries' versions:",1)[1]
    libraries=[{'name':line.split(maxsplit=1)[0],'reportedVersion':line.split(maxsplit=1)[1],
                'exactSourceArchiveVerified':False} for line in footer.splitlines() if line.strip()]
    report={'schema':1,'scope':pin['scope'],'revision':revision,'tag':pin['tag'],'archive':archive.name,
            'archiveSha256':hashlib.file_digest(archive.open('rb'),'sha256').hexdigest(),'archiveBytes':archive.stat().st_size,
            'publisher':pin['publisher'],'binaryArchiveSha256':binary['sha256'],
            'observedBinaries':[{'name':name,'sha256':hashlib.file_digest((root/'bin'/name).open('rb'),'sha256').hexdigest()} for name in ['ffmpeg.exe','ffprobe.exe']],
            'buildInfoSha256':hashlib.sha256((root/'bin/FFmpeg-BUILD-INFO.txt').read_bytes()).hexdigest(),'externalLibraries':libraries,
            'externalLibrarySourcesComplete':False,'tagSignatureVerified':False,'binaryReproduced':False,'distributionReady':False}
    for name in ['FFmpeg-BUILD-INFO.txt','FFmpeg-LICENSE.txt']:shutil.copyfile(root/'bin'/name,destination/name)
    (destination/'report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    (root/'build/ffmpeg-cli-source-review-latest.json').write_text(json.dumps({'folder':str(destination),'revision':revision,'distributionReady':False},indent=2)+'\n',encoding='utf-8')
    return destination


if __name__=='__main__':print(capture())
