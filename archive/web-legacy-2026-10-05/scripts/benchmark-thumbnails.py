"""Compare image-only FFmpeg concurrency using read-only indexed source samples."""
import argparse
import json
import os
import sqlite3
import sys
import time
import uuid
from pathlib import Path

PROJECT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(PROJECT))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--index',type=Path,required=True);parser.add_argument('--source',type=Path,required=True)
    args=parser.parse_args();root=args.source.resolve(strict=True)
    output=PROJECT/'build'/'thumbnail-benchmarks'/uuid.uuid4().hex
    if output.resolve().is_relative_to(root):parser.error('Output cannot be inside source')
    os.environ['AVHUB_DATA_DIR']=str(output/'data')
    from app import main as m
    output.mkdir(parents=True,exist_ok=True)
    with sqlite3.connect(args.index.resolve().as_uri()+'?mode=ro',uri=True) as db:
        db.row_factory=sqlite3.Row
        samples=[]
        for codec in ['h264','hevc','vp9','av1']:
            for ext in ['.mp4','.mkv','.ts']:
                row=db.execute('SELECT path,duration,width,height,ext,video_codec FROM media WHERE video_codec=? AND ext=? AND duration>0.2 ORDER BY width*height DESC,id LIMIT 1',(codec,ext)).fetchone()
                if row:samples.append(dict(row))
    records=[]
    for number,item in enumerate(samples):
        source=Path(item['path']).resolve(strict=True)
        if not source.is_relative_to(root):raise ValueError('Indexed source outside approved directory')
        before=source.stat();result={key:item[key] for key in ['width','height','ext','video_codec']};result['samples']=[]
        # Alternate order to reduce (not remove) warm-cache/order bias.
        for trial,limited in enumerate(([False,True,True,False] if number%2==0 else [True,False,False,True])):
            target=output/f'{number}-{trial}.jpg'
            command=[m.executable('ffmpeg'),'-v','error','-y','-ss',str(min(item['duration']*.12,60))]
            if limited:command+=['-threads','2','-filter_threads','1']
            command+=['-i',str(source),'-frames:v','1','-vf','scale=480:-2','-q:v','4',str(target)]
            began=time.perf_counter()
            try:
                code,_,_=m.scan_process(command,20)
                status='ok' if code==0 and m.valid_thumbnail(target) else 'failed'
            except Exception as exc:status=type(exc).__name__
            result['samples'].append({'limited_threads':limited,'ms':round((time.perf_counter()-began)*1000),'status':status})
        after=source.stat()
        result['source_unchanged']=(before.st_size,before.st_mtime_ns)==(after.st_size,after.st_mtime_ns)
        records.append(result);print(json.dumps(result),flush=True)
    report={'samples':records,'scope':'image generation only; same seek/scale/quality; no playback encoding change; warm caches, alternating order, tiny sample'}
    (output/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps({'report':str(output/'report.json')}),flush=True)


if __name__=='__main__':main()
