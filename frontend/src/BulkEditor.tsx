import { useState } from 'react';
import { api,errorText,json } from './api';
import { Button,Dialog,StatusMessage } from './ui';
import './library-tools.css';

export function BulkEditor({ids,close,done}:{ids:number[];close:()=>void;done:(count:number)=>void}) {
  const [kind,setKind]=useState('');const [series,setSeries]=useState('');const [season,setSeason]=useState('');
  const [rating,setRating]=useState('keep');const [favorite,setFavorite]=useState('keep');const [watched,setWatched]=useState('keep');
  const [added,setAdded]=useState('');const [removed,setRemoved]=useState('');
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  async function save() {
    const changes:Record<string,unknown>={};
    if(kind)changes.kind=kind;
    if(series.trim()) {
      if(kind && kind!=='episode'){setError('填写剧名时请选择剧集类型，或清空剧名');return;}
      changes.kind='episode';changes.series_title=series.trim();
    }
    if(season!=='') {
      const number=Number(season);
      if(!Number.isInteger(number)||number<0||number>9999){setError('季编号需为 0–9999 的整数，0 表示特别篇');return;}
      changes.season=number;
    }
    if(rating!=='keep')changes.rating=rating==='none'?null:Number(rating);
    const split=(value:string)=>[...new Set(value.split(/[,，]/).map(tag=>tag.trim()).filter(Boolean))];
    setBusy(true);setError('');
    try {
      const result=await api<{updated:number}>('/api/library/batch',json('POST',{
        media_ids:ids,changes,add_tags:split(added),remove_tags:split(removed),
        ...(favorite==='keep'?{}:{favorite:favorite==='yes'}),...(watched==='keep'?{}:{watched:watched==='yes'}),
      }));done(result.updated);
    }catch(e){setError(errorText(e));}finally{setBusy(false);}
  }
  return <Dialog label="批量整理媒体信息" closeLabel="关闭批量整理" busy={busy} close={close} className="modal library-tool-dialog">
    <h2>批量整理</h2><p className="tool-description">仅修改明确选中的 {ids.length} 个视频的库内信息；空项保持不变，不改写源文件。</p>
    <fieldset disabled={busy} className="tool-fields">
      <label>类型<select aria-label="批量媒体类型" value={kind} onChange={e=>setKind(e.target.value)}><option value="">保持不变</option><option value="video">未分类视频</option><option value="movie">电影</option><option value="episode">剧集</option></select></label>
      <label>剧名<input aria-label="批量剧名" value={series} maxLength={300} placeholder="留空保持；填写将设为剧集" onChange={e=>setSeries(e.target.value)}/></label>
      <label>季编号<input aria-label="批量季编号" type="number" min="0" max="9999" value={season} placeholder="留空保持" onChange={e=>setSeason(e.target.value)}/></label>
      <label>评分<select aria-label="批量评分" value={rating} onChange={e=>setRating(e.target.value)}><option value="keep">保持不变</option><option value="none">清除评分</option>{[0,1,2,3,4,5].map(n=><option key={n} value={n}>{n} 分</option>)}</select></label>
      <label>收藏<select aria-label="批量收藏" value={favorite} onChange={e=>setFavorite(e.target.value)}><option value="keep">保持不变</option><option value="yes">收藏</option><option value="no">取消收藏</option></select></label>
      <label>观看状态<select aria-label="批量观看状态" value={watched} onChange={e=>setWatched(e.target.value)}><option value="keep">保持不变</option><option value="yes">标记已看</option><option value="no">标记未看</option></select></label>
      <label>添加标签<input aria-label="批量添加标签" value={added} placeholder="逗号分隔，保留原有标签" onChange={e=>setAdded(e.target.value)}/></label>
      <label>移除标签<input aria-label="批量移除标签" value={removed} placeholder="仅移除这些标签" onChange={e=>setRemoved(e.target.value)}/></label>
    </fieldset>
    {error&&<StatusMessage kind="error">{error}</StatusMessage>}
    <div className="tool-footer"><Button disabled={busy} onClick={close}>取消</Button><Button icon="save" variant="primary" busy={busy} onClick={()=>void save()}>应用到 {ids.length} 个视频</Button></div>
  </Dialog>;
}
