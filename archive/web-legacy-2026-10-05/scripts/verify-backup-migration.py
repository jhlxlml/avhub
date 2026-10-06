"""Complete backup across isolated profiles, using a copied real index/cache."""
import argparse
import asyncio
import importlib.util
import json
import os
import shutil
import sqlite3
import sys
import time
from pathlib import Path
from unittest.mock import patch
from starlette.requests import Request

PROJECT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(PROJECT))
parser=argparse.ArgumentParser();parser.add_argument('--source',type=Path,required=True);parser.add_argument('--index',type=Path,required=True);parser.add_argument('--jobs',action='store_true');args=parser.parse_args()
root=args.source.resolve(strict=True);index=args.index.resolve(strict=True)
if not index.is_relative_to(PROJECT/'build'/'scan-benchmarks'):parser.error('Use benchmark input only')
folder=PROJECT/'build'/f'backup-migration-{time.time_ns()}';first=folder/'profile-a';second=folder/'profile-b';second.mkdir(parents=True)
spec=importlib.util.spec_from_file_location('benchmark',PROJECT/'scripts'/'benchmark-scan.py');benchmark=importlib.util.module_from_spec(spec);spec.loader.exec_module(benchmark)
before,_=benchmark.inventory(root);os.environ['AVHUB_DATA_DIR']=str(first)
from app import main as m
from app.data_jobs import DataJobs
from contextlib import closing
with closing(sqlite3.connect(index.as_uri()+'?mode=ro',uri=True)) as original,closing(sqlite3.connect(m.DB)) as target:original.backup(target)
m.bootstrap()
for image in (index.parent/'thumbnails').glob('*.jpg'):shutil.copyfile(image,m.THUMBS/image.name)
cover=first/'covers'/('b'*32+'.jpg');cover.parent.mkdir();shutil.copyfile(next(m.THUMBS.glob('*.jpg')),cover)
with m.connection() as db:
    if any(not Path(row[0]).resolve().is_relative_to(root) for row in db.execute('SELECT path FROM media')):raise ValueError('Index outside authorized source')
    db.execute("UPDATE media SET custom_cover=?,favorite=1,progress=42 WHERE id=1",(f'covers/{cover.name}',))
    db.execute('DELETE FROM thumbnail_jobs')
    total=db.execute('SELECT COUNT(*) FROM media').fetchone()[0]
report={'build':m.BUILD,'indexed':total,'scope':'Copied benchmark database/cache, no daily library or source writes'}
def wait_job(identity,label):
    deadline=time.monotonic()+300;observations=[];last=None
    while True:
        value=m.data_jobs.get(identity).public()
        key=(value['state'],value['stage'],value['done'],value['total'])
        if key!=last:
            observations.append({'state':value['state'],'stage':value['stage'],'done':value['done'],'total':value['total']});last=key
        if value['state']!='running':break
        if time.monotonic()>deadline:raise TimeoutError(f'{label} did not complete')
        time.sleep(.03)
    report[label+'_progress']=observations
    if value['state']!='ready':raise RuntimeError(value['error'] or value['state'])
    return value
try:
    began=time.perf_counter()
    if args.jobs:
        started=m.start_backup_job(m.BackupJobInput(full=True,thumbnails=True));wait_job(started['id'],'backup')
        archive=m.data_jobs.get(started['id']).folder/'avhub-library.zip'
    else:
        response=m.create_backup(full=True,thumbnails=True);archive=Path(response.path)
    report.update(backup_seconds=round(time.perf_counter()-began,3),archive_bytes=archive.stat().st_size)
    payload=archive.read_bytes();(second/'thumbnails').mkdir()
    isolated_jobs=DataJobs(lambda:second)
    with patch.object(m,'DATA',second),patch.object(m,'DB',second/'library.db'),patch.object(m,'THUMBS',second/'thumbnails'),patch.object(m,'data_jobs',isolated_jobs):
        m.bootstrap()
        async def receive():return {'type':'http.request','body':payload,'more_body':False}
        request=Request({'type':'http','method':'POST','path':'/api/backup/restore','headers':[]},receive)
        began=time.perf_counter()
        if args.jobs:
            inspect=asyncio.run(m.start_inspect_job(request));preview=wait_job(inspect['id'],'inspect');report['preview']=preview['result']
            m.commit_data_job(inspect['id']);report['restore_result']=wait_job(inspect['id'],'restore')['result']
        else:report['restore_result']=asyncio.run(m.restore_backup(request))
        report['restore_seconds']=round(time.perf_counter()-began,3)
        record=m.media_record(1);report['favorite_progress_cover_restored']=bool(record['favorite'] and record['progress']==42 and m.valid_thumbnail(second/record['custom_cover']))
        with m.connection() as db:
            report['restored_count']=db.execute('SELECT COUNT(*) FROM media').fetchone()[0]
            report['restored_thumbnails']=db.execute('SELECT COUNT(*) FROM media WHERE thumbnail IS NOT NULL').fetchone()[0]
            first_root=dict(db.execute('SELECT * FROM roots LIMIT 1').fetchone());db.execute('UPDATE roots SET path=? WHERE id=?',(str(folder/'disconnected'),first_root['id']))
        report['offline_prompt']=not m.root_status(str(first_root['id']))[0]['available']
        with m.connection() as db:db.execute('UPDATE roots SET path=? WHERE id=?',(first_root['path'],first_root['id']))
        relocated=folder/'relocated-empty';relocated.mkdir()
        report['relocate_result']=m.relocate_root(first_root['id'],m.RelocateInput(path=str(relocated)))
        record=m.media_record(1);report['relocate_preserves_progress_cover']=bool(record['progress']==42 and record['favorite'] and m.valid_thumbnail(second/record['custom_cover']))
        if report['restored_count']!=total or not all(report[key] for key in ['favorite_progress_cover_restored','offline_prompt','relocate_preserves_progress_cover']):raise RuntimeError('Migration validation incomplete')
        isolated_jobs.close()
finally:
    m.data_jobs.close();m.playback.close();after,_=benchmark.inventory(root)
    report['source_check']={'added':sum(path not in before for path in after),'removed':sum(path not in after for path in before),
        'size_or_mtime_changed':sum(after[path]!=value for path,value in before.items() if path in after)}
    destination=folder/'report.json';destination.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({**report,'report':str(destination)}),flush=True)
