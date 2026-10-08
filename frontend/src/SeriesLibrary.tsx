import { useEffect,useState,type ReactNode } from 'react';
import { api,errorText,json,type Media,type MediaPage } from './api';
import { Button,EmptyState,StatusMessage } from './ui';
import { Pagination } from './Pagination';
import { MediaThumbnail } from './MediaThumbnail';
import { Icon } from './Icon';
import { duration } from './api';
import { episodeLabel } from './mediaLabels';
import {ResolutionBadge} from './ResolutionBadge';
import './library-tools.css';
import {LibraryPageCache,useLibraryQuery} from './useLibraryQuery';
import {LibraryHeading} from './LibraryHeading';

type Group={id:number;title:string;count:number;available_count:number;watched_count:number;seasons:number;thumbnail_url?:string|null;thumbnail_media_id?:number|null};
type GroupPage={items:Group[];total:number;page:number;pages:number;page_size:number};
type Episodes=MediaPage&{id:number;title:string;seasons:{season:number|null;count:number;available_count:number}[]};

export function SeriesLibrary({cache,active,q,root,show,season,page,pageSize,revision,filterSummary,change,play}:{cache:LibraryPageCache;active:boolean;q:string;root:string;show:string;season:string;page:number;pageSize:number;revision:number;filterSummary:ReactNode;
  change:(value:{show?:string;season?:string;page?:number;pageSize?:number})=>void;play:(media:Media)=>void}) {
  const [writeError,setError]=useState('');const [retry,setRetry]=useState(0);
  const params=new URLSearchParams({page:String(page),page_size:String(pageSize)});
  if(root)params.set('root_id',root);
  if(show){if(season)params.set('season',season);}else if(q)params.set('q',q);
  const query=useLibraryQuery<GroupPage|Episodes>(active?`${show?`/api/series/${show}`:'/api/series'}?${params}`:null,revision,cache,q,retry);
  const groups=show?null:query.data as GroupPage|undefined;
  const episodes=show?query.data as Episodes|undefined:null;
  const loading=query.loading,error=writeError||query.error;
  const [renaming,setRenaming]=useState(false),[name,setName]=useState(''),[saving,setSaving]=useState(false);
  useEffect(()=>{setRenaming(false);setError('');},[show]);
  useEffect(()=>{
    const ids=episodes?.items.map(item=>item.id)||groups?.items.map(group=>group.thumbnail_media_id).filter(Boolean);
    if(!ids?.length)return;
    void api('/api/thumbnails/priority',json('POST',{ids:ids.slice(0,120)})).catch(()=>{});
  },[episodes?.items,groups?.items]);
  useEffect(()=>{
    const refresh=()=>{
      const ids=episodes?.items.map(item=>item.id).join(',')||groups?.items.map(group=>group.thumbnail_media_id).filter(Boolean).join(',');
      if(!ids)return;
      void api<{id:number;thumbnail_url?:string|null}[]>(`/api/thumbnails/versions?ids=${ids}`).then(values=>{
        const covers=new Map(values.map(value=>[value.id,value.thumbnail_url]));
        cache.clear();
        query.update(current=>current?{...current,items:current.items.map(item=>{
          const id='thumbnail_media_id' in item?item.thumbnail_media_id||0:item.id;
          return covers.has(id)?{...item,thumbnail_url:covers.get(id)??undefined}:item;
        })} as GroupPage|Episodes:current);
      }).catch(()=>{});
    };
    window.addEventListener('avhub-thumbnails-published',refresh);
    return()=>window.removeEventListener('avhub-thumbnails-published',refresh);
  },[episodes,groups,query.update,cache]);
  async function rename() {
    setSaving(true);setError('');
    try{await api(`/api/series/${show}`,json('PATCH',{title:name.trim()}));cache.clear();setRenaming(false);setRetry(n=>n+1);}
    catch(e){setError(errorText(e));}finally{setSaving(false);}
  }
  useEffect(()=>{if(query.data&&query.data.page!==page)change({page:query.data.page});},[query.data,page]);
  const result=show?episodes:groups;
  return <section className="series-library" aria-label="剧集聚合库">
    {show&&<div className="series-heading"><Button icon="arrowLeft" onClick={()=>change({show:'',season:'',page:1})}>返回剧集库</Button><h2>{episodes?.title||'剧集详情'}</h2>
      {!loading&&episodes&&<Button icon="edit" disabled={saving} onClick={()=>{setName(episodes.title);setRenaming(value=>!value);}}>修改剧名</Button>}
      <label>季<select aria-label="选择季" value={season} onChange={e=>change({season:e.target.value,page:1})}><option value="">全部季</option>{episodes?.seasons.map(s=><option key={s.season??'unknown'} value={s.season??'unknown'}>{s.season===null?'季未设置':s.season===0?'特别篇':`第 ${s.season} 季`} · {s.count} 集</option>)}</select></label>
    </div>}
    {show&&renaming&&<form className="series-heading" onSubmit={event=>{event.preventDefault();void rename();}}><input aria-label="分组剧名" value={name} maxLength={300} disabled={saving} onChange={event=>setName(event.target.value)}/><Button type="submit" icon="save" busy={saving} disabled={!name.trim()}>保存剧名</Button><small>仅修改分组显示名，不改动文件或单集标题</small></form>}
    <LibraryHeading title={show?'单集列表':'按剧集归类'} filters={filterSummary}
      count={result?`共 ${result.total} ${show?'集':'个剧集'} · 本页 ${result.items.length} ${show?'集':'个'}`:query.showLoading?'正在加载…':''}
      updating={Boolean(result&&query.showLoading)}/>
    {error&&result&&<StatusMessage kind="error">{error}<Button icon="refresh" onClick={()=>{setError('');cache.clear();setRetry(n=>n+1);}}>重试剧集库</Button></StatusMessage>}
    {error&&!result?<><StatusMessage kind="error">{error}</StatusMessage><Button icon="refresh" onClick={()=>{setError('');cache.clear();setRetry(n=>n+1);}}>重试剧集库</Button></>:loading&&!result?<div className="library-query-placeholder" aria-label="剧集列表载入中" aria-busy="true">{query.showLoading&&<StatusMessage kind="loading">正在加载剧集…</StatusMessage>}</div>:
      show?episodes?.items.length?<div className="series-episodes">{episodes.items.map(m=><button key={m.id} className="series-episode" disabled={Boolean(m.missing)} aria-label={m.missing?`离线 ${m.title}`:`播放 ${m.title}`} onClick={()=>play({...m,series_title:episodes.title})}>
        <span className="episode-cover"><MediaThumbnail url={m.thumbnail_url} retryKey={revision}/><Icon name={m.missing?'warning':'play'} size={20}/></span><span className="episode-meta"><b>{episodeLabel(m)}</b><span title={m.name}>{m.name}</span><small className="episode-status"><ResolutionBadge width={m.width} height={m.height}/>{m.missing?'源文件离线':m.watched?'已看完':m.progress>0?`看到 ${duration(m.progress)}`:'未观看'}</small></span><span>{duration(m.duration)}</span>
      </button>)}</div>:<EmptyState icon="series" title="当前季暂无视频" description="可以切换季或检查媒体目录。"/>:
      groups?.items.length?<div className="media-grid series-groups">{groups.items.map(group=><article className="card" key={group.id}>
        <button className="series-group-cover cover" aria-label={`打开剧集 ${group.title}`} onClick={()=>change({show:String(group.id),season:'',page:1})}><MediaThumbnail url={group.thumbnail_url} retryKey={revision}/><span className="series-count">{group.count} 集</span></button>
        <div className="meta"><button className="video-title" title={group.title} onClick={()=>change({show:String(group.id),season:'',page:1})}>{group.title}</button><span>{group.seasons} 季 · 已看 {group.watched_count}/{group.available_count}{group.count>group.available_count?` · 离线 ${group.count-group.available_count}`:''}</span></div>
      </article>)}</div>:<EmptyState icon="series" title="暂无匹配剧集" description="可在媒体信息或批量整理中设置剧名、季与集；不会请求联网资料。"/>}
    {!error&&result&&<Pagination page={page} pages={result.pages} total={result.total} pageSize={pageSize} busy={loading} itemLabel={show?'集':'部剧集'}
      changePage={page=>change({page})} changeSize={pageSize=>change({pageSize,page:1})}/>}
  </section>;
}
