"""Bounded read-only classic AVC sample-table index (never reads mdat).

Only a single untrimmed timeline is accepted. Fragmented movies, complex edit
lists, multiple sample descriptions and inconsistent tables use the established
FFprobe path instead. The demuxer's first packet anchors its edit-list offset.
Format reference: https://developer.apple.com/documentation/quicktime-file-format
"""
import struct

MAX_METADATA=16*1024**2
MAX_ENTRIES=250000
MAX_SAMPLES=3000000


class UnsafeCopyColor(ValueError):
    pass


def integer(data,offset,kind='I'):
    try:return struct.unpack_from('>'+kind,data,offset)[0]
    except struct.error as exc:raise ValueError('截断的 MP4 时间表') from exc


def boxes(data):
    at=0;count=0
    while at<len(data):
        count+=1
        if count>4096 or len(data)-at<8:raise ValueError('无效 MP4 元数据区间')
        size=integer(data,at);kind=bytes(data[at+4:at+8]);header=8
        if size==1:size=integer(data,at+8,'Q');header=16
        elif size==0:size=len(data)-at
        if size<header or at+size>len(data):raise ValueError('无效 MP4 元数据长度')
        yield kind,data[at+header:at+size]
        at+=size


def children(data):
    result={}
    for kind,value in boxes(data):
        if kind in result:raise ValueError('重复 MP4 时间表')
        result[kind]=value
    return result


def table(data,columns,signed_last=False):
    if not data or data[0]!=(1 if signed_last else 0):raise ValueError('未知 MP4 样本表版本')
    count=integer(data,4)
    if not 0<count<=MAX_ENTRIES or len(data)!=8+count*columns*4:raise ValueError('无效 MP4 时间表数量')
    pattern='>'+'I'*(columns-1)+('i' if signed_last else 'I')
    return list(struct.iter_unpack(pattern,data[8:]))


def movie_metadata(source,cancelled):
    with source.open('rb') as reader:
        size=source.stat().st_size;at=0
        for _ in range(4096):
            if cancelled.is_set():raise ValueError('已取消封装索引')
            if at==size:break
            reader.seek(at);header=reader.read(8)
            if len(header)!=8:raise ValueError('截断的 MP4 文件头')
            length,kind=struct.unpack('>I4s',header);head=8
            if length==1:
                extra=reader.read(8)
                if len(extra)!=8:raise ValueError('截断的 MP4 扩展长度')
                length=struct.unpack('>Q',extra)[0];head=16
            elif length==0:length=size-at
            if length<head or at+length>size:raise ValueError('无效 MP4 文件区间')
            if kind==b'moov':
                if length-head>MAX_METADATA:raise ValueError('MP4 时间表过大')
                raw=reader.read(length-head)
                if len(raw)!=length-head:raise ValueError('截断的 MP4 时间表')
                return memoryview(raw)
            # Seek over media payloads, including >4 GiB extended mdat boxes.
            at+=length
    raise ValueError('缺少 classic MP4 时间表')


def sample_keys(source,cancelled):
    movie=list(boxes(movie_metadata(source,cancelled)))
    if any(kind==b'mvex' for kind,_ in movie):raise ValueError('分片 MP4 需探测时间轴')
    for kind,track in movie:
        if kind!=b'trak':continue
        parts=children(track);media=children(parts[b'mdia'])
        if bytes(media[b'hdlr'][8:12])!=b'vide':continue
        description=media[b'mdhd'];version=description[0]
        if version not in (0,1):raise ValueError('未知 MP4 时间表版本')
        scale=integer(description,12 if version==0 else 20)
        duration=integer(description,16 if version==0 else 24,'I' if version==0 else 'Q')
        if not scale or not 0<duration/scale<86400:raise ValueError('无效 MP4 时基')
        sample=children(children(media[b'minf'])[b'stbl'])
        sd=sample[b'stsd']
        if sd[0]!=0 or integer(sd,4)!=1:raise ValueError('多编码 MP4 需探测时间轴')
        descriptions=list(boxes(sd[8:]))
        if len(descriptions)!=1 or descriptions[0][0] not in (b'avc1',b'avc3'):raise ValueError('非 AVC MP4')
        times=table(sample[b'stts'],2)
        if sample[b'stsz'][0]!=0:raise ValueError('未知 MP4 样本大小表版本')
        count=integer(sample[b'stsz'],8)
        if not 0<count<=MAX_SAMPLES or sum(n for n,_ in times)!=count or any(n==0 or delta==0 for n,delta in times):
            raise ValueError('MP4 解码时间表不完整')
        # Some muxers round mdhd to whole seconds. Sample count is exact above;
        # tolerate only that small header rounding, never a missing table tail.
        if abs(sum(n*delta for n,delta in times)-duration)>scale:raise ValueError('MP4 媒体时长不一致')
        composition=sample.get(b'ctts')
        if composition is not None:
            if composition[0] not in (0,1):raise ValueError('未知 MP4 呈现时间表版本')
            offsets=table(composition,2,composition[0]==1)
            if sum(n for n,_ in offsets)!=count or any(n==0 or abs(offset)>scale*5 for n,offset in offsets):
                raise ValueError('MP4 呈现时间表不完整')
        else:offsets=[(count,0)]
        edit=children(parts[b'edts']).get(b'elst') if b'edts' in parts else None
        if edit is not None:
            version=edit[0]
            if version not in (0,1) or integer(edit,4)!=1:raise ValueError('复杂 MP4 编辑时间表')
            media_time=integer(edit,12 if version==0 else 16,'i' if version==0 else 'q')
            rate=16 if version==0 else 24
            if len(edit)!=(20 if version==0 else 28) or integer(edit,rate,'h')!=1 or integer(edit,rate+2,'h')!=0 or not 0<=media_time<=max(0,offsets[0][1]):
                raise ValueError('裁剪或变速 MP4 需探测时间轴')
        sync=sample.get(b'stss')
        keys=[n[0]-1 for n in table(sync,1)] if sync is not None else range(count)
        if keys[0]!=0 or keys[-1]>=count or any(a>=b for a,b in zip(keys,keys[1:])):raise ValueError('无效 MP4 同步帧')
        ti=ci=0;time_start=composition_start=0;dts=0;result=[]
        for index in keys:
            if cancelled.is_set():raise ValueError('已取消封装索引')
            while index>=time_start+times[ti][0]:
                n,delta=times[ti];time_start+=n;dts+=n*delta;ti+=1
            while index>=composition_start+offsets[ci][0]:
                composition_start+=offsets[ci][0];ci+=1
            decode=dts+(index-time_start)*times[ti][1]
            result.append((decode/scale,(decode+offsets[ci][1])/scale))
            if len(result)>50000:raise ValueError('MP4 同步帧过多')
        return result,scale
    raise ValueError('缺少 MP4 视频轨道')


def container_copy_color(source,cancelled):
    """Read exact numeric colr tags, including values FFprobe labels unknown.

    ICC/custom colour profiles cannot be represented by AVC VUI. Refuse rather
    than relabel them as SDR or silently drop their container-only information.
    """
    for kind,track in boxes(movie_metadata(source,cancelled)):
        if kind!=b'trak':continue
        media=children(children(track)[b'mdia'])
        if bytes(media[b'hdlr'][8:12])!=b'vide':continue
        sd=children(children(media[b'minf'])[b'stbl'])[b'stsd']
        entries=list(boxes(sd[8:]))
        if len(entries)!=1:raise UnsafeCopyColor('色彩标记无法无损封装：多编码描述，请返回原片播放')
        codec,entry=entries[0]
        if codec not in (b'avc1',b'avc3'):return {}
        if len(entry)<78:raise UnsafeCopyColor('色彩标记无法无损封装：视频描述不完整')
        tags=[data for kind,data in boxes(entry[78:]) if kind==b'colr']
        if not tags:return {}
        if len(tags)!=1:raise UnsafeCopyColor('色彩标记无法无损封装：重复色彩描述')
        tag=tags[0];kind=bytes(tag[:4])
        if kind not in (b'nclx',b'nclc') or len(tag)!=(11 if kind==b'nclx' else 10):
            raise UnsafeCopyColor('色彩标记无法无损封装：ICC 或未知色彩描述，请返回原片播放')
        values=[integer(tag,at,'H') for at in (4,6,8)]
        if any(value>255 for value in values):raise UnsafeCopyColor('色彩标记无法无损封装：超出 AVC 标记范围')
        result=dict(zip(('colour_primaries','transfer_characteristics','matrix_coefficients'),values))
        if kind==b'nclx':result['video_full_range_flag']=(tag[10]>>7)&1
        return result
    return {}


def quick_timeline(source,ffprobe,run,cancelled):
    import json
    keys,scale=sample_keys(source,cancelled)
    # Anchor FFmpeg's actual edit-list offset using a bounded packet count, not
    # a whole-movie packet scan; arbitrary edit lists above are rejected.
    code,raw,_=run([ffprobe,'-v','error','-fflags','+genpts','-select_streams','v:0','-read_intervals','%+#8','-show_packets',
        '-show_entries','packet=pts_time,dts_time,flags:format=start_time,duration','-of','json',str(source)],5,cancelled)
    if code or len(raw)>1024**2:raise ValueError('无法校验 MP4 首关键帧')
    probe=json.loads(raw);first=probe['packets'][0]
    if 'K' not in first.get('flags',''):raise ValueError('MP4 首包非关键帧')
    shift=float(first['dts_time'])-keys[0][0]
    if abs(keys[0][1]+shift-float(first['pts_time']))>max(.00001,1/scale):raise ValueError('MP4 时间轴锚点不一致')
    return {'packets':[{'dts_time':dts+shift,'pts_time':pts+shift,'flags':'K'} for dts,pts in keys],
            'format':probe['format']}
