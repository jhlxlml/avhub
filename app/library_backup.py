"""Versioned, checked portable data archives. Never extract arbitrary ZIP paths."""
import hashlib
import json
import re
import sqlite3
import stat
import zipfile
from contextlib import closing
from pathlib import Path

MAX_ARCHIVE=2*1024**3
MAX_DATABASE=512*1024**2
MAX_ENTRIES=150002
MAX_MANIFEST=24*1024**2
IMAGE_NAME=re.compile(r'(?:covers/[a-f0-9]{32}|thumbnails/[1-9][0-9]{0,18})\.jpg\Z')


def bounded_jpeg(path):
    """Check dimensions without launching a decoder for every archived image."""
    with path.open('rb') as image:
        if image.read(2)!=b'\xff\xd8':return False
        while image.tell()<path.stat().st_size:
            if image.read(1)!=b'\xff':return False
            marker=image.read(1)
            while marker==b'\xff':marker=image.read(1)
            if not marker or marker in (b'\xd9',b'\xda'):return False
            if marker in (b'\xd8',b'\x01') or 0xd0<=marker[0]<=0xd7:continue
            size=int.from_bytes(image.read(2),'big')
            if size<2:return False
            if marker[0] in (0xc0,0xc1,0xc2):
                frame=image.read(5)
                if len(frame)!=5:return False
                height=int.from_bytes(frame[1:3],'big');width=int.from_bytes(frame[3:5],'big')
                return 0<width<=10000 and 0<height<=10000 and width*height<=20000000
            image.seek(size-2,1)
    return False


def digest(path,check=lambda:None):
    result=hashlib.sha256()
    with path.open('rb') as file:
        for chunk in iter(lambda:file.read(1024*1024),b''):check();result.update(chunk)
    return result.hexdigest()


def create(destination,snapshot,data,include_thumbnails,valid_image,progress=lambda *args:None,check=lambda:None,build=None):
    if snapshot.stat().st_size>MAX_DATABASE:raise ValueError('数据库超过 512 MB，无法创建受支持的备份')
    entries={'library.db':snapshot}
    with closing(sqlite3.connect(snapshot)) as db:
        for media_id,cover,thumbnail in db.execute('SELECT id,custom_cover,thumbnail FROM media'):
            check()
            if cover:
                if not IMAGE_NAME.fullmatch(cover) or not cover.startswith('covers/'):
                    raise ValueError('手动封面引用无效，请修复后再备份')
                file=data/cover
                if file.is_symlink() or not file.resolve().is_relative_to(data.resolve()) or not file.is_file() or file.stat().st_size>8*1024**2 or not valid_image(file) or not bounded_jpeg(file):
                    raise ValueError('手动封面缺失或不可读取，完整备份已取消')
                entries[cover]=file
            name=f'thumbnails/{media_id}.jpg'
            file=data/name
            if include_thumbnails and thumbnail and file.is_file() and file.stat().st_size<=8*1024**2 and not file.is_symlink() and file.resolve().is_relative_to(data.resolve()) and valid_image(file) and bounded_jpeg(file):
                entries[name]=file;db.execute('UPDATE media SET thumbnail=? WHERE id=?',(name,media_id))
            else:db.execute('UPDATE media SET thumbnail=NULL WHERE id=?',(media_id,))
        db.commit()
    if len(entries)>MAX_ENTRIES-1 or sum(file.stat().st_size for file in entries.values())>MAX_ARCHIVE:
        raise ValueError('完整备份超过 2 GB 或文件数量上限，请不包含缩略图后重试')
    progress('checksumming',0,len(entries));records={}
    for number,(name,file) in enumerate(entries.items(),1):
        records[name]={'size':file.stat().st_size,'sha256':digest(file,check)};progress('checksumming',number,len(entries))
    manifest={'format':'avhub-library','version':1,'thumbnails':include_thumbnails,'build':build,'files':records}
    if len(json.dumps(manifest).encode())>MAX_MANIFEST:raise ValueError('备份清单过大，请减少缩略图')
    with zipfile.ZipFile(destination,'w',compression=zipfile.ZIP_STORED,allowZip64=True) as archive:
        archive.writestr('manifest.json',json.dumps(manifest,ensure_ascii=False))
        progress('packing',0,len(entries))
        for number,(name,file) in enumerate(entries.items(),1):
            with file.open('rb') as source,archive.open(name,'w',force_zip64=True) as output:
                for chunk in iter(lambda:source.read(1024*1024),b''):check();output.write(chunk)
            progress('packing',number,len(entries))
    if destination.stat().st_size>MAX_ARCHIVE:raise ValueError('备份包超过 2 GB，请不包含缩略图后重试')


def unpack(uploaded,staging,validate_database,valid_image,progress=lambda *args:None,check=lambda:None):
    # Staging is a newly-created private application directory, never a root path.
    try:
        with zipfile.ZipFile(uploaded) as archive:
            items=archive.infolist();names=[item.filename for item in items]
            if len(items)>MAX_ENTRIES or len(names)!=len(set(names)):raise ValueError('备份有重复文件或文件数量过多')
            if 'manifest.json' not in names or 'library.db' not in names:raise ValueError('不是完整 AVHub 备份')
            if sum(item.file_size for item in items)>MAX_ARCHIVE:raise ValueError('备份解压大小超过 2 GB')
            for item in items:
                if item.filename not in ('manifest.json','library.db') and not IMAGE_NAME.fullmatch(item.filename):
                    raise ValueError('备份含不允许的文件路径')
                mode=(item.external_attr>>16)&0xffff
                if stat.S_ISLNK(mode) or item.is_dir() or item.flag_bits&1:raise ValueError('备份不支持链接、目录项或加密文件')
            if archive.getinfo('manifest.json').file_size>MAX_MANIFEST:raise ValueError('备份清单过大')
            manifest=json.loads(archive.read('manifest.json'))
            if manifest.get('format')!='avhub-library' or manifest.get('version')!=1:raise ValueError('不支持此备份版本')
            entries=manifest.get('files')
            if not isinstance(entries,dict) or set(entries)!=(set(names)-{'manifest.json'}):raise ValueError('备份清单与文件不一致')
            progress('validating',0,len(entries))
            for number,(name,expected) in enumerate(entries.items(),1):
                check()
                info=archive.getinfo(name);limit=MAX_DATABASE if name=='library.db' else 8*1024**2
                if not isinstance(expected,dict) or expected.get('size')!=info.file_size or info.file_size>limit:
                    raise ValueError('备份文件大小无效或超过上限')
                target=staging/name;target.parent.mkdir(parents=True,exist_ok=True)
                total=0;checksum=hashlib.sha256()
                with archive.open(name) as source,target.open('xb') as output:
                    for chunk in iter(lambda:source.read(1024*1024),b''):
                        check()
                        total+=len(chunk)
                        if total>limit or total>info.file_size:raise ValueError('备份文件解压超出声明大小')
                        output.write(chunk);checksum.update(chunk)
                if total!=expected['size'] or checksum.hexdigest()!=expected.get('sha256'):raise ValueError('备份校验失败，文件可能损坏')
                if name!='library.db' and (not valid_image(target) or not bounded_jpeg(target)):raise ValueError('备份含无效或超大图片')
                progress('validating',number,len(entries))
    except (zipfile.BadZipFile,RuntimeError,KeyError,TypeError,AttributeError,UnicodeError,json.JSONDecodeError) as exc:
        raise ValueError('完整备份损坏或格式不正确') from exc
    check();progress('database-check',0,1);database=staging/'library.db';validate_database(database)
    with closing(sqlite3.connect(database)) as db:
        columns={row[1] for row in db.execute('PRAGMA table_info(media)')}
        if not {'custom_cover','thumbnail','size','modified'}.issubset(columns):raise ValueError('完整备份缺少媒体字段')
        covers={row[0] for row in db.execute('SELECT custom_cover FROM media WHERE custom_cover IS NOT NULL')}
        thumbnails={row[0] for row in db.execute('SELECT thumbnail FROM media WHERE thumbnail IS NOT NULL')}
        images=set(entries)-{'library.db'}
        if images!=covers|thumbnails:raise ValueError('图片与数据库引用不一致')
        if any(not isinstance(name,str) or not name.startswith('covers/') or not IMAGE_NAME.fullmatch(name) for name in covers):
            raise ValueError('手动封面引用无效')
        for media_id,thumbnail in db.execute('SELECT id,thumbnail FROM media WHERE thumbnail IS NOT NULL'):
            if thumbnail!=f'thumbnails/{media_id}.jpg':raise ValueError('缩略图引用无效')
    progress('database-check',1,1);return database,images
