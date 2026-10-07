import { useEffect, useRef, useState } from 'react';
import { api, json, errorText, duration, type Media, type Playlist, type PlaylistPage, type PlaylistSource, type QueuePage } from './api';
import { Icon } from './Icon';
import { Button, Dialog, StatusMessage } from './ui';
import { episodeLabel, formatLabel } from './mediaLabels';
import {ResolutionBadge} from './ResolutionBadge';
import { MediaThumbnail } from './MediaThumbnail';
import { changeAutoplay, useAutoplay } from './autoplay';
import {confirmAction} from './confirmAction';

type Membership={revision:number;count:number;added?:number;existing?:number;removed?:{media_id:number;position:number}[];restored?:number};
type Undo={id:number;revision:number;removed:{media_id:number;position:number}[]};

export function Playlists({ close, play, addMedia,addMediaIds, added }: {
  close: () => void; play: (source: PlaylistSource, media: Media) => void; addMedia?: Media;addMediaIds?:number[]; added: (message: string) => void;
}) {
  const adding=Boolean(addMedia||addMediaIds?.length);
  const [lists, setLists] = useState<Playlist[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<PlaylistPage | null>(null);
  const [name, setName] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [targetId, setTargetId] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [revision, setRevision] = useState(0);
  const [picked,setPicked]=useState<number[]>([]),[selecting,setSelecting]=useState(false),[undo,setUndo]=useState<Undo|null>(null),[notice,setNotice]=useState('');
  const active = useRef(true);
  const autoplay = useAutoplay();
  async function refreshLists(preferred?: number | null) {
    const result = await api<Playlist[]>('/api/playlists');
    if (!active.current) return;
    setLists(result);
    setSelectedId(current => preferred === null ? result[0]?.id ?? null : preferred ?? (result.some(item => item.id===current) ? current : result[0]?.id ?? null));
    if (adding) setTargetId(current => current || (result[0] ? String(result[0].id) : ''));
  }
  useEffect(() => {
    active.current = true;
    void refreshLists().catch(e => { if(active.current) setError(errorText(e)); });
    return () => { active.current = false; };
  }, []);
  useEffect(() => {
    if (!selectedId || adding) { setDetail(null); setLoading(false); return; }
    const controller = new AbortController();
    setLoading(true); setError('');
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({page:String(page),page_size:'40',q:search});
      void api<PlaylistPage>(`/api/playlists/${selectedId}?${params}`,{signal:controller.signal}).then(value => {
        if (!controller.signal.aborted) { setDetail(value); if(page!==value.page) setPage(value.page); }
      }).catch(e => { if(!controller.signal.aborted) setError(errorText(e)); })
        .finally(() => { if(!controller.signal.aborted) setLoading(false); });
    }, search ? 180 : 0);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [selectedId,page,search,revision,adding]);
  async function mutate(action: () => Promise<unknown>, preferred?: number | null) {
    if(busy) return;
    setBusy(true); setError('');
    try { await action(); if(active.current) { await refreshLists(preferred); setRevision(value=>value+1); } }
    catch(e) { if(active.current) setError(errorText(e)); }
    finally { if(active.current) setBusy(false); }
  }
  async function createList() {
    if(!name.trim()) throw new Error('请输入播放列表名称');
    const created=await api<Playlist>('/api/playlists',json('POST',{name:name.trim()}));
    if(active.current) { setName(''); setPage(1); setSearch(''); }
    return created;
  }
  async function create() { await mutate(async()=>{ const value=await createList(); await refreshLists(value.id); }); }
  async function addToList() {
    await mutate(async()=>{
      let message:string;
      if(name.trim() || !targetId) {
        if(!name.trim()) throw new Error('请输入新播放列表名称，或选择已有列表');
        const result=await api<Playlist>('/api/playlists',json('POST',{name:name.trim(),...(addMediaIds?{media_ids:addMediaIds}:{media_id:addMedia!.id})}));
        message=addMediaIds?`已创建“${result.name}”并加入 ${result.count} 个视频`:`已将“${addMedia!.title}”加入播放列表`;
      } else if(addMediaIds){
        const current=await api<PlaylistPage>(`/api/playlists/${Number(targetId)}?page=1&page_size=1`);
        const result=await api<Membership>(`/api/playlists/${Number(targetId)}/items/batch`,json('POST',{action:'add',media_ids:addMediaIds,expected_revision:current.revision}));
        message=`已加入 ${result.added} 个视频${result.existing?` · ${result.existing} 个已在列表中`:''}`;
      } else {
        await api(`/api/playlists/${Number(targetId)}/items/${addMedia!.id}?compact=true`,{method:'POST'});
        message=`已将“${addMedia!.title}”加入播放列表`;
      }
      if(active.current) { added(message); close(); }
    });
  }
  function selectList(id:number) {setPicked([]);setSelecting(false);setUndo(null);setNotice('');setSelectedId(id); setPage(1); setSearch(''); setEditingName(false); setDetail(null); setRevision(value=>value+1); }
  function pick(ids:number[]){setPicked(current=>{const next=[...new Set([...current,...ids])];if(next.length>500){setError('一次最多选择 500 个视频');return current;}return next;});}
  async function removeItems(ids:number[]){
    if(!detail||!ids.length)return;
    await mutate(async()=>{
      const result=await api<Membership>(`/api/playlists/${detail.id}/items/batch`,json('POST',{action:'remove',media_ids:ids,expected_revision:detail.revision}));
      if(active.current){setUndo({id:detail.id,revision:result.revision,removed:result.removed||[]});setPicked(current=>current.filter(id=>!ids.includes(id)));setNotice(`已从片单移除 ${result.removed?.length||0} 个视频，原文件不变。`);}
    });
  }
  async function remove(item:Media) {
    await removeItems([item.id]);
  }
  async function undoRemoval(){
    if(!undo||!detail||undo.id!==detail.id)return;
    await mutate(async()=>{const result=await api<Membership>(`/api/playlists/${undo.id}/items/restore`,json('POST',{removed:undo.removed,expected_revision:undo.revision}));if(active.current){setUndo(null);setNotice(`已恢复 ${result.restored} 个视频及原来的片单位置。`);}});
  }
  async function move(item:Media,direction:-1|1) {
    if(!detail) return;
    await mutate(async()=>{await api(`/api/playlists/${detail.id}/items/${item.id}/move`,json('POST',{direction,expected_revision:detail.revision}));if(active.current){setUndo(null);setNotice('');}});
  }
  async function rename(event:React.FormEvent) {
    event.preventDefault(); if(!detail) return;
    await mutate(async()=>{ await api(`/api/playlists/${detail.id}?compact=true`,json('PATCH',{name:renameValue.trim()})); setEditingName(false); });
  }
  async function deleteList() {
    if(!detail || !confirmAction('删除播放列表？',`“${detail.name}” · ${detail.count} 个视频`,'删除片单名称和顺序记录，视频文件不会受影响。此操作不能撤销。')) return;
    await mutate(()=>api(`/api/playlists/${detail.id}`,{method:'DELETE'}),null);
    setPage(1); setSearch('');
  }
  async function playFirst(shuffle=false) {
    if(!detail || busy) return;
    setBusy(true); setError('');
    try {
      const value=await api<QueuePage>(`/api/playlists/${detail.id}/queue?page_size=40${shuffle?'&shuffle=true':''}`);
      if(active.current && value.current) {
        changeAutoplay({mode:shuffle?'random':'sequential'});
        play({id:detail.id,name:detail.name},value.current);
      }
    } catch(e) { if(active.current) setError(errorText(e)); }
    finally { if(active.current) setBusy(false); }
  }
  const locked=busy || loading;
  return <Dialog backdropClassName="playlist-backdrop" className={`playlist-panel${adding?' add-to-playlist':' playlist-workspace'}`} label={adding?'加入播放列表':'播放列表'} closeLabel="关闭" busy={busy} close={close}>
      {adding ? <>
        <h2 className="dialog-title"><Icon name="playlist" size={22}/>加入播放列表</h2><p className="playlist-subtitle">{addMediaIds?`已选择 ${addMediaIds.length} 个视频 · 按选择顺序加入，已有条目不会重复添加`:addMedia!.title}</p>
        {lists.length>0 && <label className="playlist-field">选择列表<select aria-label="选择播放列表" disabled={busy} value={targetId} onChange={event=>{setTargetId(event.target.value);setName('');}}>
          <option value="">新建播放列表</option>
          {lists.map(list=><option key={list.id} value={list.id}>{list.name}（{list.count}）</option>)}
        </select></label>}
        <label className="playlist-field">或新建列表<input aria-label="新播放列表名称" disabled={busy} value={name} maxLength={80} placeholder="填写名称后创建并加入，例如：周末待看" onChange={event=>{setName(event.target.value);setTargetId('');}} /></label>
        {error && <StatusMessage className="playlist-error" kind="error">{error}</StatusMessage>}
        <div className="playlist-actions"><Button onClick={close} disabled={busy}>取消</Button><Button variant="primary" busy={busy} onClick={()=>void addToList()}>{busy?'正在添加…':'添加到列表'}</Button></div>
      </> : <>
        <div className="playlist-workspace-header"><div><h2 className="dialog-title"><Icon name="playlist" size={22}/>播放列表</h2><span className="playlist-library-count">{lists.length} 个片单 · 仅保存在本机</span></div>
        <form className="playlist-create" onSubmit={event=>{event.preventDefault();void create();}}>
          <input aria-label="播放列表名称" disabled={busy} value={name} maxLength={80} placeholder="新建片单…" onChange={event=>setName(event.target.value)} /><button className="ui-button" disabled={busy}><Icon name="plus" size={16}/>新建</button>
        </form></div>
        <nav className="playlist-list" aria-label="播放列表">{lists.length?lists.map(list=><button key={list.id} className={selectedId===list.id?'selected':''} aria-pressed={selectedId===list.id} disabled={busy} title={list.name} onClick={()=>selectList(list.id)}>
          <Icon name="playlist" size={15}/><span>{list.name}</span><small>{list.count}</small></button>):<span className="playlist-no-lists">还没有播放列表，上方输入名称即可创建</span>}</nav>
        <div className="playlist-content">
          <div className="playlist-detail">{detail && detail.id===selectedId ? <>
            <aside className="playlist-summary" aria-label="片单信息">
            <div className="playlist-hero-cover" aria-label="播放列表封面">
              <MediaThumbnail url={detail.cover_media?.thumbnail_url}/><span className="playlist-cover-badge" aria-label={`${detail.count} 个视频`}><Icon name="playlist" size={14}/>{detail.count}</span>
            </div>
            <div className="playlist-detail-heading"><div>{editingName?<form className="playlist-rename" onSubmit={event=>void rename(event)}>
              <input aria-label="重命名播放列表" disabled={busy} maxLength={80} value={renameValue} onChange={event=>setRenameValue(event.target.value)} /><button aria-label="保存列表名称" disabled={locked||!renameValue.trim()}>保存</button><button type="button" disabled={busy} onClick={()=>setEditingName(false)}>取消</button>
            </form>:<><span className="playlist-eyebrow"><Icon name="shield" size={13}/>本地播放列表</span><h3>{detail.name}</h3><small>{detail.count} 个视频{detail.playable_count<detail.count?` · ${detail.playable_count} 个可播放`:''}{detail.total_duration?` · ${duration(detail.total_duration)}`:''}</small></>}</div></div>
              <div className="playlist-start-actions"><Button icon="play" variant="primary" aria-label="从头播放" title="按片单顺序播放；是否连播遵循播放偏好" disabled={!detail.playable_count || locked} onClick={()=>void playFirst()}>播放全部</Button>
                <Button icon="shuffle" aria-label="随机播放列表" title="从完整片单随机起播；是否连播遵循播放偏好" disabled={!detail.playable_count || locked} onClick={()=>void playFirst(true)}>随机播放</Button></div>
              <div className="playlist-detail-actions"><button className="ui-button" aria-label="重命名列表" disabled={locked} onClick={()=>{setRenameValue(detail.name);setEditingName(true);}}><Icon name="edit" size={14}/>重命名</button>
                <button className="ui-button danger-action" aria-label="删除列表" disabled={locked} onClick={()=>void deleteList()}><Icon name="trash" size={14}/>删除列表</button></div>
              <p className="playlist-summary-note"><Icon name="continue" size={14}/>{autoplay.enabled?'连播已开启':'连播已关闭'}<span>可在设置的播放偏好中调整</span></p>
            </aside>
            <section className="playlist-videos" aria-label="片单视频">
            <div className="playlist-video-toolbar"><span><Icon name="list" size={16}/>{search?`${detail.total} 个搜索结果`:'片单顺序'}</span><label className="playlist-search-wrap"><Icon name="search" size={16}/><input className="playlist-search" type="search" aria-label="搜索播放列表视频" placeholder="搜索此片单" value={search} onChange={event=>{setSearch(event.target.value);setPage(1);}} /></label></div>
            <div className="playlist-bulk-controls"><Button icon="check" disabled={locked} aria-pressed={selecting} onClick={()=>{setSelecting(value=>!value);setPicked([]);}}>{selecting?'结束多选':'多选视频'}</Button>{selecting&&<><span>已选 {picked.length} / 500 · 支持跨页</span><Button disabled={locked} onClick={()=>pick(detail.items.map(item=>item.id))}>选择本页片单视频</Button><Button disabled={locked||!picked.length} onClick={()=>setPicked([])}>清空片单选择</Button><Button icon="close" disabled={locked||!picked.length} onClick={()=>void removeItems(picked)}>移除所选片单视频</Button></>}</div>
            {loading?<StatusMessage kind="loading">正在加载列表…</StatusMessage>:detail.items.length?<ol className="playlist-video-items">{detail.items.map(item=><li key={item.id} className={item.missing?'is-offline':''}>
              {selecting&&<input type="checkbox" className="playlist-pick" aria-label={`选择片单视频 ${item.title}`} checked={picked.includes(item.id)} disabled={locked} onChange={event=>event.target.checked?pick([item.id]):setPicked(current=>current.filter(id=>id!==item.id))}/>}
              <button className="playlist-item-play" aria-label={item.missing?`不可播放 ${item.title}（文件离线）`:`播放 ${item.title}`} disabled={Boolean(item.missing)||busy} onClick={()=>play({id:detail.id,name:detail.name},item)}>
                <span className="playlist-index">{(item.playlist_index??0)+1}</span><span className="playlist-video-cover"><MediaThumbnail url={item.thumbnail_url}/><span className="playlist-video-duration">{duration(item.duration)}</span>{item.progress>0&&!item.watched&&<span className="playlist-video-progress" style={{width:`${Math.min(100,item.progress/Math.max(1,item.duration)*100)}%`}}/>}</span>
                <span className="playlist-item-copy"><span className="playlist-item-title">{item.title}</span><span className="playlist-video-meta">{item.missing?<span className="playlist-offline-label"><Icon name="warning" size={12}/>文件离线</span>:<><ResolutionBadge width={item.width} height={item.height}/>{item.kind==='episode'?episodeLabel(item):formatLabel(item.ext)}{item.watched?' · 已看完':item.progress>0?` · 看到 ${duration(item.progress)}`:''}</>}</span><span className="playlist-video-filename" title={item.name}>{item.name}</span></span></button>
              <div className="playlist-item-actions"><button aria-label={`上移 ${item.title}`} title="上移" disabled={locked||!item.previous_item_id} onClick={()=>void move(item,-1)}><Icon name="chevronUp" size={16}/></button><button aria-label={`下移 ${item.title}`} title="下移" disabled={locked||!item.next_item_id} onClick={()=>void move(item,1)}><Icon name="chevronDown" size={16}/></button><button className="playlist-remove" aria-label={`从播放列表移除 ${item.title}`} title="从列表移除" disabled={locked} onClick={()=>void remove(item)}><Icon name="close" size={16}/></button></div>
            </li>)}</ol>:<p className="playlist-empty">{search?'没有匹配的视频':'列表为空，可在视频封面上点击“加入播放列表”。'}</p>}
            {detail.pages>1 && <div className="queue-pager"><span>{detail.page} / {detail.pages} 页 · {detail.total} 个</span><button aria-label="上一页播放列表视频" disabled={locked||page<=1} onClick={()=>setPage(value=>value-1)}>上一页</button><button aria-label="下一页播放列表视频" disabled={locked||page>=detail.pages} onClick={()=>setPage(value=>value+1)}>下一页</button></div>}
            </section>
          </>:<p className="playlist-empty">{loading?'正在加载列表…':'创建或选择一个列表'}</p>}</div>
        </div>
        {error && <><StatusMessage className="playlist-error" kind="error">{error}</StatusMessage><Button icon="refresh" onClick={()=>{setError('');void refreshLists().then(()=>setRevision(value=>value+1)).catch(e=>setError(errorText(e)));}}>刷新列表</Button></>}
        {notice&&<div className="playlist-operation-result" role="status"><Icon name="check" size={16}/><span>{notice}</span>{undo&&detail?.id===undo.id&&<Button icon="refresh" disabled={locked||detail.revision!==undo.revision} onClick={()=>void undoRemoval()}>撤销上次移除</Button>}{undo&&detail?.id===undo.id&&!locked&&detail.revision!==undo.revision&&<small>列表已变化，无法撤销；新的顺序已保留。</small>}</div>}
        <div className="playlist-footer"><span><Icon name="shield" size={14}/> 视频文件保持原位，不会被移动或修改</span><button className="ui-button" onClick={close} disabled={busy}><Icon name="check" size={16}/>完成</button></div>
      </>}
  </Dialog>;
}
