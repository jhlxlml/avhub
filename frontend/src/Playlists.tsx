import { useEffect, useRef, useState } from 'react';
import { api, json, errorText, type Media, type Playlist, type PlaylistPage, type PlaylistSource, type QueuePage } from './api';
import { Icon } from './Icon';
import { Button, Dialog, StatusMessage } from './ui';
import { episodeLabel, formatLabel } from './mediaLabels';

export function Playlists({ close, play, addMedia, added }: {
  close: () => void; play: (source: PlaylistSource, media: Media) => void; addMedia?: Media; added: (message: string) => void;
}) {
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
  const active = useRef(true);
  async function refreshLists(preferred?: number | null) {
    const result = await api<Playlist[]>('/api/playlists');
    if (!active.current) return;
    setLists(result);
    setSelectedId(current => preferred === null ? result[0]?.id ?? null : preferred ?? (result.some(item => item.id===current) ? current : result[0]?.id ?? null));
    if (addMedia) setTargetId(current => current || (result[0] ? String(result[0].id) : ''));
  }
  useEffect(() => {
    active.current = true;
    void refreshLists().catch(e => { if(active.current) setError(errorText(e)); });
    return () => { active.current = false; };
  }, []);
  useEffect(() => {
    if (!selectedId || addMedia) { setDetail(null); setLoading(false); return; }
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
  }, [selectedId,page,search,revision,addMedia]);
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
      if(name.trim() || !targetId) {
        if(!name.trim()) throw new Error('请输入新播放列表名称，或选择已有列表');
        await api('/api/playlists',json('POST',{name:name.trim(),media_id:addMedia!.id}));
      } else {
        await api(`/api/playlists/${Number(targetId)}/items/${addMedia!.id}?compact=true`,{method:'POST'});
      }
      if(active.current) { added(`已将“${addMedia!.title}”加入播放列表`); close(); }
    });
  }
  function selectList(id:number) { setSelectedId(id); setPage(1); setSearch(''); setEditingName(false); setDetail(null); setRevision(value=>value+1); }
  async function remove(item:Media) {
    if(!detail) return;
    await mutate(()=>api(`/api/playlists/${detail.id}/items/${item.id}?compact=true&expected_revision=${detail.revision}`,{method:'DELETE'}));
  }
  async function move(item:Media,direction:-1|1) {
    if(!detail) return;
    await mutate(()=>api(`/api/playlists/${detail.id}/items/${item.id}/move`,json('POST',{direction,expected_revision:detail.revision})));
  }
  async function rename(event:React.FormEvent) {
    event.preventDefault(); if(!detail) return;
    await mutate(async()=>{ await api(`/api/playlists/${detail.id}?compact=true`,json('PATCH',{name:renameValue.trim()})); setEditingName(false); });
  }
  async function deleteList() {
    if(!detail || !window.confirm(`删除播放列表“${detail.name}”？视频文件不会受影响。`)) return;
    await mutate(()=>api(`/api/playlists/${detail.id}`,{method:'DELETE'}),null);
    setPage(1); setSearch('');
  }
  async function playFirst() {
    if(!detail || busy) return;
    setBusy(true); setError('');
    try {
      const value=await api<QueuePage>(`/api/playlists/${detail.id}/queue?page_size=40`);
      if(active.current && value.current) play({id:detail.id,name:detail.name},value.current);
    } catch(e) { if(active.current) setError(errorText(e)); }
    finally { if(active.current) setBusy(false); }
  }
  const locked=busy || loading;
  return <Dialog backdropClassName="playlist-backdrop" className={`playlist-panel${addMedia?' add-to-playlist':''}`} label={addMedia?'加入播放列表':'播放列表'} closeLabel="关闭" busy={busy} close={close}>
      {addMedia ? <>
        <h2 className="dialog-title"><Icon name="playlist" size={22}/>加入播放列表</h2><p className="playlist-subtitle">{addMedia.title}</p>
        {lists.length>0 && <label className="playlist-field">选择列表<select aria-label="选择播放列表" disabled={busy} value={targetId} onChange={event=>{setTargetId(event.target.value);setName('');}}>
          <option value="">新建播放列表</option>
          {lists.map(list=><option key={list.id} value={list.id}>{list.name}（{list.count}）</option>)}
        </select></label>}
        <label className="playlist-field">或新建列表<input aria-label="新播放列表名称" disabled={busy} value={name} maxLength={80} placeholder="填写名称后创建并加入，例如：周末待看" onChange={event=>{setName(event.target.value);setTargetId('');}} /></label>
        {error && <StatusMessage className="playlist-error" kind="error">{error}</StatusMessage>}
        <div className="playlist-actions"><Button onClick={close} disabled={busy}>取消</Button><Button variant="primary" busy={busy} onClick={()=>void addToList()}>{busy?'正在添加…':'添加到列表'}</Button></div>
      </> : <>
        <h2 className="dialog-title"><Icon name="playlist" size={22}/>播放列表</h2><p className="playlist-subtitle">整理待看片单，按你的节奏连续播放</p>
        <form className="playlist-create" onSubmit={event=>{event.preventDefault();void create();}}>
          <input aria-label="播放列表名称" value={name} maxLength={80} placeholder="新建播放列表名称" onChange={event=>setName(event.target.value)} /><button className="ui-button primary" disabled={busy}><Icon name="plus" size={16}/>新建</button>
        </form>
        <div className="playlist-content">
          <div className="playlist-list" aria-label="播放列表">{lists.length?lists.map(list=><button key={list.id} className={selectedId===list.id?'selected':''} disabled={busy} onClick={()=>selectList(list.id)}>
            <Icon name="playlist" size={16}/><span>{list.name}</span><small>{list.count} 个</small></button>):<p className="playlist-empty">还没有播放列表</p>}</div>
          <div className="playlist-detail">{detail && detail.id===selectedId ? <>
            <div className="playlist-detail-heading"><div>{editingName?<form className="playlist-rename" onSubmit={event=>void rename(event)}>
              <input aria-label="重命名播放列表" maxLength={80} value={renameValue} onChange={event=>setRenameValue(event.target.value)} /><button aria-label="保存列表名称" disabled={locked}>保存</button><button type="button" onClick={()=>setEditingName(false)}>取消</button>
            </form>:<><h3>{detail.name}</h3><small>{detail.count} 个视频{detail.playable_count<detail.count?` · ${detail.playable_count} 个可播放`:''}</small></>}</div>
              <div className="playlist-detail-actions"><button className="ui-button" aria-label="重命名列表" disabled={locked} onClick={()=>{setRenameValue(detail.name);setEditingName(true);}}><Icon name="edit" size={14}/>重命名</button>
                <button className="ui-button danger-action" aria-label="删除列表" disabled={locked} onClick={()=>void deleteList()}><Icon name="trash" size={14}/>删除</button><button className="ui-button primary" disabled={!detail.playable_count || locked} onClick={()=>void playFirst()}><Icon name="play" size={14}/>从头播放</button></div></div>
            <input className="playlist-search" type="search" aria-label="搜索播放列表视频" placeholder="搜索列表中的视频…" value={search} onChange={event=>{setSearch(event.target.value);setPage(1);}} />
            {loading?<StatusMessage kind="loading">正在加载列表…</StatusMessage>:detail.items.length?<ol>{detail.items.map(item=><li key={item.id}>
              <button className="playlist-item-play" aria-label={item.missing?`不可播放 ${item.title}（文件离线）`:`播放 ${item.title}`} disabled={Boolean(item.missing)||busy} onClick={()=>play({id:detail.id,name:detail.name},item)}>
                <span className="playlist-index">{String((item.playlist_index??0)+1).padStart(2,'0')}</span><span className="playlist-item-title">{item.title}</span><small>{item.missing?'文件离线':item.kind==='episode'?episodeLabel(item):formatLabel(item.ext)}</small></button>
              <div className="playlist-item-actions"><button aria-label={`上移 ${item.title}`} title="上移" disabled={locked||!item.previous_item_id} onClick={()=>void move(item,-1)}><Icon name="chevronUp" size={16}/></button><button aria-label={`下移 ${item.title}`} title="下移" disabled={locked||!item.next_item_id} onClick={()=>void move(item,1)}><Icon name="chevronDown" size={16}/></button><button className="playlist-remove" aria-label={`从播放列表移除 ${item.title}`} title="从列表移除" disabled={locked} onClick={()=>void remove(item)}><Icon name="close" size={16}/></button></div>
            </li>)}</ol>:<p className="playlist-empty">{search?'没有匹配的视频':'列表为空，可在视频封面上点击“加入播放列表”。'}</p>}
            {detail.pages>1 && <div className="queue-pager"><span>{detail.page} / {detail.pages} 页 · {detail.total} 个</span><button aria-label="上一页播放列表视频" disabled={locked||page<=1} onClick={()=>setPage(value=>value-1)}>上一页</button><button aria-label="下一页播放列表视频" disabled={locked||page>=detail.pages} onClick={()=>setPage(value=>value+1)}>下一页</button></div>}
          </>:<p className="playlist-empty">{loading?'正在加载列表…':'创建或选择一个列表'}</p>}</div>
        </div>
        {error && <><StatusMessage className="playlist-error" kind="error">{error}</StatusMessage><Button icon="refresh" onClick={()=>{setError('');void refreshLists().then(()=>setRevision(value=>value+1)).catch(e=>setError(errorText(e)));}}>刷新列表</Button></>}
        <div className="playlist-footer"><span><Icon name="shield" size={14}/> 视频文件保持原位，不会被移动或修改</span><button className="ui-button" onClick={close} disabled={busy}><Icon name="check" size={16}/>完成</button></div>
      </>}
  </Dialog>;
}
