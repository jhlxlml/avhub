"""Checked, restart-time copy of library data. Source videos are never accessed."""
import json
import hashlib
import re
import shutil
import sqlite3
import uuid
from contextlib import closing
from pathlib import Path

MAX_BYTES=2*1024**3
def checksum(file):
    with file.open('rb') as source:
        return hashlib.file_digest(source,'sha256').hexdigest()
def write_config(file,value):
    if file.is_symlink():raise ValueError('数据目录配置不可为链接')
    temporary=file.with_name(file.name+'.'+str(uuid.uuid4())+'.tmp')
    with temporary.open('x',encoding='utf-8') as output:
        json.dump(value,output,ensure_ascii=False)
    temporary.replace(file)

def configured_directory(home,legacy):
    home=Path(home);legacy=Path(legacy);file=home/'avhub-data-location.json'
    if file.exists():
        if file.is_symlink() or file.stat().st_size>65536:raise ValueError('数据目录配置不可读取')
        config=json.loads(file.read_text(encoding='utf-8'))
        directory=config.get('directory')
        if config.get('version')!=1 or not isinstance(directory,str) or not Path(directory).is_absolute():raise ValueError('数据目录配置无效')
    else:
        directory=str(home/'AVHub-data');config={'version':1,'directory':directory}
        if (legacy/'library.db').is_file() and not (Path(directory)/'library.db').exists():
            if Path(directory).exists() and any(Path(directory).iterdir()):raise ValueError('默认 AVHub-data 非空，请备份后手动迁移')
            config['pending']={'id':str(uuid.uuid4()),'source':str(legacy.resolve()),'target':directory};write_config(file,config)
    destination=Path(directory);destination.mkdir(parents=True,exist_ok=True)
    if config.get('pending'):
        pending=config['pending']
        if pending.get('target')!=directory:raise ValueError('数据迁移配置无效')
        migrate(pending['source'],directory,pending['id']);write_config(file,{'version':1,'directory':directory})
    return destination.resolve()

def migrate(source,target,identity):
    if str(uuid.UUID(identity))!=identity:raise ValueError('迁移标识无效')
    source=Path(source).resolve(strict=True);target=Path(target).resolve(strict=True)
    if source==target or source.is_relative_to(target) or target.is_relative_to(source):raise ValueError('迁移目录不能相互包含')
    database=source/'library.db'
    if database.is_symlink() or not database.is_file() or database.stat().st_size>512*1024**2:raise ValueError('源媒体库不可迁移')
    if shutil.disk_usage(target).free<database.stat().st_size+256*1024**2:raise ValueError('目标目录可用空间不足')
    marker=target/'.avhub-data-migration.json'
    if (target/'library.db').is_symlink():raise ValueError('目标数据库不可为链接')
    expected={'id':identity,'source':str(source),'target':str(target)}
    if marker.exists():
        if marker.is_symlink():raise ValueError('迁移标记不可为链接')
        owned=json.loads(marker.read_text(encoding='utf-8'))
        if any(owned.get(k)!=v for k,v in expected.items()):raise ValueError('目标目录属于另一迁移任务')
        if owned.get('complete'):
            if not (target/'library.db').is_file():raise ValueError('已迁移数据库缺失')
            return
        if (target/'library.db').exists():
            if (target/'library.db').is_symlink() or checksum(target/'library.db')!=owned.get('database_sha256'):raise ValueError('目标数据库不属于未完成的迁移，拒绝覆盖')
            write_config(marker,{**owned,'complete':True});return
    else:
        if any((target/name).exists() for name in ('library.db','thumbnails','covers')):raise ValueError('目标目录已有媒体库，拒绝覆盖')
        write_config(marker,expected)
    staging=target/('.avhub-migration-'+identity)
    staging.mkdir(exist_ok=True)
    if staging.is_symlink():raise ValueError('迁移暂存目录不可为链接')
    snapshot=staging/'library.db'
    if snapshot.is_symlink():raise ValueError('迁移暂存数据库不可为链接')
    with closing(sqlite3.connect(database.as_uri()+'?mode=ro',uri=True,timeout=30)) as src, closing(sqlite3.connect(snapshot)) as dst:
        src.backup(dst)
        if dst.execute('PRAGMA quick_check').fetchone()[0]!='ok':raise ValueError('数据库完整性检查失败')
        tables={r[0] for r in dst.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not {'media','roots','preferences'}.issubset(tables):raise ValueError('不是受支持的 AVHub 媒体库')
        columns={r[1] for r in dst.execute('PRAGMA table_info(media)')}
        images=[]
        for row in dst.execute('SELECT id,thumbnail'+(',custom_cover' if 'custom_cover' in columns else '')+' FROM media'):
            media_id,thumbnail=row[:2]
            if thumbnail:
                name=f'thumbnails/{media_id}.jpg'
                if (source/name).is_file():images.append(name)
                else:dst.execute('UPDATE media SET thumbnail=NULL WHERE id=?',(media_id,))
            if len(row)>2 and row[2]:
                if not re.fullmatch(r'covers/[a-f0-9]{32}\.jpg',row[2]):raise ValueError('自定义封面引用无效')
                images.append(row[2])
        dst.commit()
    images=list(dict.fromkeys(images));total=snapshot.stat().st_size
    if len(images)>150000:raise ValueError('封面数量超过迁移上限')
    for name in images:
        image=source/name
        if image.is_symlink() or not image.resolve().is_relative_to(source) or not image.is_file() or image.stat().st_size>8*1024**2:raise ValueError('封面不可读取或超出大小限制')
        total+=image.stat().st_size
    if total>MAX_BYTES or shutil.disk_usage(target).free<total+256*1024**2:raise ValueError('迁移空间不足或超过 2 GB，请先清理缓存并备份')
    for name in images:
        image=staging/name;image.parent.mkdir(exist_ok=True)
        if image.is_symlink() or image.parent.is_symlink():raise ValueError('迁移图片目录不可为链接')
        shutil.copyfile(source/name,image)
    # Native folder-choice memory is a small, application-owned settings file.
    # Do not copy arbitrary files or the Chromium profile from the old directory.
    choice=source/'avhub-directory-choices.json'
    if choice.exists():
        if choice.is_symlink() or not choice.is_file() or choice.stat().st_size>16384:raise ValueError('目录选择设置文件不可迁移')
        value=json.loads(choice.read_text(encoding='utf-8'))
        if value.get('version')!=1 or not isinstance(value.get('folders'),dict):raise ValueError('目录选择设置格式无效')
        for key,location in value['folders'].items():
            if key not in ('media','screenshots') or not isinstance(location,str) or not Path(location).is_absolute():raise ValueError('目录选择设置格式无效')
        final=target/choice.name
        if final.is_symlink() or (final.exists() and checksum(final)!=checksum(choice)):raise ValueError('目标目录已有不同的目录选择设置')
        if not final.exists():shutil.copyfile(choice,final)
    manifest={**expected,'database_sha256':checksum(snapshot),'images':{name:checksum(staging/name) for name in images}}
    write_config(marker,manifest)
    # Publish images first; library.db is the final commit point. An owned,
    # interrupted publication can resume, but unrelated files are never replaced.
    for directory in ('thumbnails','covers'):
        origin=staging/directory;destination=target/directory
        if origin.exists():
            if destination.exists():
                if destination.is_symlink():raise ValueError('目标封面目录不可为链接')
                for file in destination.iterdir():
                    name=f'{directory}/{file.name}'
                    if file.is_symlink() or not file.is_file() or checksum(file)!=manifest['images'].get(name):raise ValueError('目标封面目录有其他内容，拒绝覆盖')
            else:destination.mkdir()
            for file in origin.iterdir():
                name=f'{directory}/{file.name}';final=destination/file.name
                if name not in manifest['images']:raise ValueError('迁移暂存目录有未授权文件')
                if not final.exists():file.rename(final)
    if (target/'library.db').exists():raise ValueError('目标数据库已存在，拒绝覆盖')
    snapshot.rename(target/'library.db')
    write_config(marker,{**manifest,'complete':True})
