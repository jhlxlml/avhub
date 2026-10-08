import { useEffect, useState } from 'react';
import { api, duration, errorText, type Media, type QueuePage, type PlaylistSource } from './api';
import { preference, savePreference } from './preferences';
import { Icon } from './Icon';
import { StatusMessage, Button } from './ui';
import { type QueueMode, type QueueScope } from './autoplay';

function savedOpen() { return preference('queueOpen',false); }

export function PlaybackQueue({ media, queue, busy, play, siblings, setSiblings,mode,setMode,autoNext,setAutoNext,scope,setScope }: {
  media: Media; queue?: PlaylistSource; busy: boolean; play: (media: Media) => void;
  siblings: QueuePage | null; setSiblings: (value: QueuePage|null) => void;
  mode:QueueMode;setMode:(value:QueueMode)=>void;autoNext:boolean;setAutoNext:(value:boolean)=>void;
  scope:QueueScope;setScope:(value:QueueScope)=>void;
}) {
  const [open, setOpen] = useState(savedOpen);
  const [page, setPage] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    savePreference('queueOpen',open);
  }, [open]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setSiblings(null);
    const params = new URLSearchParams({ page_size: '40' });
    if (page !== null) params.set('page', String(page));
    if(queue) { params.set('media_id',String(media.id)); params.set('q',search); }
    else params.set('scope',scope);
    const timer=window.setTimeout(()=>{
    void api<QueuePage>(queue ? `/api/playlists/${queue.id}/queue?${params}` : `/api/media/${media.id}/siblings?${params}`, { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) setSiblings(value);
    }).catch(e => { if (!controller.signal.aborted) setError(errorText(e)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, search?180:0);
    return () => {controller.abort();clearTimeout(timer);};
  }, [media.id, queue, page, search, retry, setSiblings, scope]);
  const size = 40;
  const pages = siblings?.pages ?? 1;
  const currentPage = siblings?.page ?? 1;
  const shown = siblings?.items ?? [];
  const total = siblings?.count ?? siblings?.total;
  return <section className="playback-queue" aria-label="待播队列">
    <button className="queue-heading" aria-label={open ? '收起待播队列' : '展开待播队列'} aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span><Icon name={open?'chevronDown':'chevronRight'} size={14}/><Icon name={queue||siblings?.scope==='series'?'playlist':'folder'} size={16}/>{queue ? siblings?.name || queue.name : siblings?.scope==='series' ? `同剧集 · ${siblings.name}` : '同目录视频'}</span><small>{error?'加载失败':total ? `${(siblings?.index??0)+1} / ${total}` : loading?'正在加载…':'0 个视频'}</small>
    </button>
    {open && <div className="queue-content">
      <div className="queue-options"><label>播放模式<select aria-label="播放模式" value={mode} onChange={event=>setMode(event.target.value as QueueMode)}>
        <option value="sequential">顺序播放</option><option value="random">随机播放</option><option value="repeat-one">单条循环</option>
      </select></label><label><input type="checkbox" aria-label="自动连播" checked={autoNext} onChange={event=>setAutoNext(event.target.checked)}/>自动连播</label>
      {!queue&&<label>连播范围<select aria-label="队列连播范围" value={scope} onChange={event=>{setPage(null);setScope(event.target.value as QueueScope);}}>
        <option value="series">同一剧集（默认）</option><option value="directory">同一目录</option>
      </select></label>}
      <small>{queue?'仅影响本次片单播放，不改变全局播放偏好；':'设置保存为全局播放偏好；'}随机从完整待播队列选择，不限当前页；关闭连播后结束即停。</small></div>
      {queue && <input type="search" aria-label="搜索待播队列" placeholder="搜索列表中的视频…" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} />}
      {!queue && <small className="queue-hint">{siblings?.scope==='series'?'按季、集排列 · 仅同一剧集，最后一集结束即停':'按文件名排列 · 仅当前实际目录，不含子目录'}</small>}
      {error ? <StatusMessage kind="error">{error} <Button icon="refresh" onClick={() => setRetry(value => value+1)}>重试待播队列</Button></StatusMessage> : loading ? <StatusMessage kind="loading">正在加载待播队列…</StatusMessage> :
        shown.length ? <ol aria-label="待播视频">{shown.map((item, rowIndex) => <li key={item.id}>
          <button aria-label={`队列播放 ${item.title}`} aria-current={item.id === media.id ? 'true' : undefined}
            disabled={busy || Boolean(item.missing) || item.id === media.id} title={item.name} onClick={() => play(item)}>
            <span className="queue-number">{item.id === media.id ? <Icon name="play" size={13}/> : (item.playlist_index??((currentPage-1)*size+rowIndex))+1}</span>
            {item.thumbnail_url && <img src={item.thumbnail_url} alt="" loading="lazy" decoding="async" />}
            <span className="queue-item-text"><b>{item.title}</b><small>{item.missing ? '文件离线' : `${item.name} · ${duration(item.duration)}`}</small></span>
          </button></li>)}</ol> : <p>没有匹配的视频</p>}
      {(pages > 1 || Boolean(search)) && <div className="queue-pager"><span>{currentPage} / {pages} 页</span>
        <button aria-label="定位当前待播视频" disabled={loading} onClick={() => { setSearch(''); setPage(null); }}>当前视频</button>
        <button aria-label="上一页待播视频" disabled={loading || currentPage<=1} onClick={() => setPage(currentPage-1)}>上一页</button>
        <button aria-label="下一页待播视频" disabled={loading || currentPage>=pages} onClick={() => setPage(currentPage+1)}>下一页</button></div>}
    </div>}
  </section>;
}
