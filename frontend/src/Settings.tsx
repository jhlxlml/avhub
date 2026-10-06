import { useEffect, useState } from 'react';
import { api, json, errorText, type Root } from './api';
import {BackupTools} from './BackupTools';
import {StorageTools} from './StorageTools';
import './settings.css';
import { Icon, type IconName } from './Icon';
import { Button, Dialog, StatusMessage } from './ui';
import { Diagnostics } from './Diagnostics';
import { type ThumbnailStatus } from './ThumbnailTasks';
import { ScreenshotSettings } from './ScreenshotSettings';
import { AutoplaySettings } from './AutoplaySettings';
import { NativePrepareSettings } from './NativePrepareSettings';
import {ResumeBehaviorSettings} from './ResumeBehaviorSettings';
import {AppDataTools,requestAbout} from './AppTools';

const tabs:{id:string;label:string;icon:IconName}[]=[{id:'directories',label:'媒体目录',icon:'folder'},{id:'playback',label:'播放偏好',icon:'play'},{id:'data',label:'数据管理',icon:'database'},{id:'diagnostics',label:'运行诊断',icon:'info'}];

export function Settings({ roots, close, reload, scanning, scan, previewEnabled, changePreview,thumbnailStatus,changeThumbnailStatus }: { roots: Root[]; close: () => void; reload: () => Promise<void>; scanning: boolean; scan: (root?: number) => Promise<void>; previewEnabled:boolean; changePreview:(enabled:boolean)=>void;thumbnailStatus:ThumbnailStatus|null;changeThumbnailStatus:(value:ThumbnailStatus)=>void }) {
  const [tab,setTab]=useState('directories');
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeError, setNoticeError] = useState(false);
  const [rootQuery, setRootQuery] = useState('');
  const [rootPage, setRootPage] = useState(1);
  const [availability, setAvailability] = useState<Record<number, boolean>>({});
  async function toggleThumbnails(){
    setBusy(true);setNotice('');
    try{changeThumbnailStatus(await api<ThumbnailStatus>(`/api/thumbnails/${thumbnailStatus?.paused?'resume':'pause'}`,{method:'POST'}));}
    catch(e){setNoticeError(true);setNotice(errorText(e));}finally{setBusy(false);}
  }
  const matching = roots.filter(root => root.path.toLocaleLowerCase().includes(rootQuery.trim().toLocaleLowerCase()));
  const rootPages = Math.max(1, Math.ceil(matching.length / 20));
  const page = Math.min(rootPage, rootPages);
  const shownRoots = matching.slice((page - 1) * 20, page * 20);
  const statusIds = shownRoots.map(root => root.id).join(',');
  useEffect(() => {
    if (!statusIds || tab!=='directories') return;
    const controller = new AbortController();
    void api<Root[]>(`/api/roots/status?ids=${statusIds}`, { signal: controller.signal }).then(values => {
      if (!controller.signal.aborted) setAvailability(current => ({ ...current, ...Object.fromEntries(values.map(root => [root.id, root.available === true])) }));
    }).catch(() => {});
    return () => controller.abort();
  }, [statusIds, roots, tab]);
  async function add(pick: boolean) {
    if (busy) return;
    setBusy(true); setNotice(''); setNoticeError(false);
    try {
      if(pick&&window.avhubDesktop) {
        if(!window.avhubDesktop.chooseFolder)throw new Error('请重新编译并启动 Electron 桌面组件');
        const chosen=await window.avhubDesktop.chooseFolder('media');if('cancelled' in chosen)return;
        await api<Root>('/api/roots',json('POST',{path:chosen.path}));
        setPath('');await reload();setNotice('目录已加入，点击顶栏“刷新媒体库”开始扫描');return;
      }
      const result = await api<Root | { cancelled: true }>(pick ? '/api/roots/pick' : '/api/roots',
        pick ? { method: 'POST' } : json('POST', { path: path.trim() }));
      if (!('cancelled' in result)) {
        setPath(''); await reload(); setNotice('目录已加入，点击顶栏“刷新媒体库”开始扫描');
      }
    } catch (e) { setNoticeError(true); setNotice(errorText(e)); }
    finally { setBusy(false); }
  }
  async function remove(id: number) {
    setBusy(true); setNotice(''); setNoticeError(false);
    try { await api(`/api/roots/${id}`, { method: 'DELETE' }); await reload(); }
    catch (e) { setNoticeError(true); setNotice(errorText(e)); }
    finally { setBusy(false); }
  }
  async function relocate(id: number) {
    if (busy) return;
    setBusy(true); setNotice(''); setNoticeError(false);
    try {
      if(window.avhubDesktop) {
        if(!window.avhubDesktop.chooseFolder)throw new Error('请重新编译并启动 Electron 桌面组件');
        const chosen=await window.avhubDesktop.chooseFolder('media');if('cancelled' in chosen)return;
        await api(`/api/roots/${id}/relocate`,json('POST',{path:chosen.path}));
        await reload();setNotice('目录已重新定位，请刷新媒体库重新扫描');return;
      }
      const result = await api<Root | { cancelled: true }>(`/api/roots/${id}/relocate/pick`, { method: 'POST' });
      if (!('cancelled' in result)) { await reload(); setNotice(`目录已重新定位，关联 ${'relocated' in result ? result.relocated : 0} 个视频；请刷新媒体库重新扫描`); }
    } catch (e) { setNoticeError(true); setNotice(errorText(e)); }
    finally { setBusy(false); }
  }
  useEffect(()=>{
    const quitting=(event:Event)=>{if(busy)(event as CustomEvent<Promise<unknown>[]>).detail.push(Promise.resolve(false));};
    window.addEventListener('avhub-before-quit',quitting);return()=>window.removeEventListener('avhub-before-quit',quitting);
  },[busy]);
  return <Dialog labelledBy="settings-title" closeLabel="关闭设置" busy={busy} close={close}>
      <h2 id="settings-title" className="dialog-title"><Icon name="settings" size={22}/>媒体库设置</h2><p className="dialog-description">管理本地目录、预览与数据备份。原视频始终保持原位。</p>
      <div className="settings-tabs" role="tablist" aria-label="设置分类">{tabs.map((item,index)=><button key={item.id} id={'settings-tab-'+item.id} role="tab" aria-selected={tab===item.id} aria-controls={'settings-panel-'+item.id} tabIndex={tab===item.id?0:-1} disabled={busy} onClick={()=>setTab(item.id)} onKeyDown={event=>{
        if(busy||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();
        const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
        setTab(tabs[next].id);document.getElementById('settings-tab-'+tabs[next].id)?.focus();
      }}><Icon name={item.icon} size={16}/>{item.label}</button>)}</div>
      <div className="settings-panel" role="tabpanel" id="settings-panel-directories" aria-labelledby="settings-tab-directories" hidden={tab!=='directories'}>
      <section className="settings-section" aria-label="媒体目录">
      <h3><Icon name="folder"/>媒体目录</h3>
      <form onSubmit={e => { e.preventDefault(); void add(false); }}>
        <input aria-label="目录路径" value={path} onChange={e => setPath(e.target.value)} placeholder="例如 D:\Videos" />
        <Button type="submit" variant="primary" icon="plus" disabled={busy || scanning || !path.trim()}>添加目录</Button>
      </form>
      <button className="ui-button" disabled={busy || scanning} onClick={() => void add(true)}><Icon name="folder" size={16}/>{busy ? '正在处理…' : '浏览本地文件夹'}</button>
      {roots.length > 20 && <input className="root-search" type="search" aria-label="搜索已添加目录" placeholder="搜索已添加的目录…" value={rootQuery} onChange={event => { setRootQuery(event.target.value); setRootPage(1); }} />}
      <div className="root-list">{shownRoots.map(root => <div key={root.id}>
        <span className="root-icon"><Icon name="folder" size={18}/></span>
        <div className="root-info"><code title={root.path}>{root.path}</code>{(availability[root.id] ?? root.available) === false && <small>目录离线或不可访问</small>}</div>
        <button className="ui-button" disabled={busy || scanning} onClick={() => void scan(root.id)}><Icon name="refresh" size={14}/>扫描此目录</button>
        {(availability[root.id] ?? root.available) === false && <button className="ui-button" disabled={busy || scanning} onClick={() => void relocate(root.id)}><Icon name="reveal" size={14}/>重新定位</button>}
        <button className="ui-button danger-action" disabled={busy || scanning} onClick={() => void remove(root.id)}><Icon name="close" size={14}/>移除</button>
      </div>)}</div>
      {roots.length > 20 && <div className="root-pager" aria-label="目录分页"><span>匹配 {matching.length} 个目录 · {page} / {rootPages} 页</span><button disabled={page <= 1} onClick={() => setRootPage(page - 1)}>上一页目录</button><button disabled={page >= rootPages} onClick={() => setRootPage(page + 1)}>下一页目录</button></div>}
      </section>
      </div><div className="settings-panel" role="tabpanel" id="settings-panel-playback" aria-labelledby="settings-tab-playback" hidden={tab!=='playback'}>
      <AutoplaySettings busy={busy}/>
      <ResumeBehaviorSettings busy={busy} changeBusy={setBusy}/>
      <NativePrepareSettings busy={busy} changeBusy={setBusy}/>
      <ScreenshotSettings busy={busy} changeBusy={setBusy} enabled={tab==='playback'}/>
      <section className="settings-section" aria-label="后台封面"><h3><Icon name="camera"/>后台封面</h3>
        <div className="thumbnail-task-summary"><span>待处理 {thumbnailStatus?.pending??0}</span><span>失败 {thumbnailStatus?.failed??0}</span><span>{thumbnailStatus?.paused?'已暂停':thumbnailStatus?.yielding?'播放优先，暂时让路':'独立后台处理'}</span></div>
        <Button icon={thumbnailStatus?.paused?'play':'pause'} busy={busy} onClick={()=>void toggleThumbnails()}>{thumbnailStatus?.paused?'恢复封面任务':'暂停封面任务'}</Button>
        <small>播放时自动让路，不改变手动暂停设置；离开播放器或活动信号超时后恢复。</small></section>
      <section className="preview-preference"><label><input type="checkbox" aria-label="封面悬停预览" disabled={busy} checked={previewEnabled} onChange={event=>changePreview(event.target.checked)} />封面悬停预览</label>
        <small>停留 0.65 秒后静音预览，每次仅播放一个原片片段。不兼容时保留封面，不触发转码；开启会增加读取与解码负载。</small></section>
      </div><div className="settings-panel" role="tabpanel" id="settings-panel-data" aria-labelledby="settings-tab-data" hidden={tab!=='data'}><AppDataTools busy={busy} enabled={tab==='data'}/><BackupTools busy={busy} changeBusy={setBusy} scanning={scanning} reload={reload}/><StorageTools busy={busy} changeBusy={setBusy} scanning={scanning} enabled={tab==='data'}/></div>
      {notice && <StatusMessage className="settings-message" kind={noticeError ? 'error' : 'info'}>{notice}</StatusMessage>}
      <div className="settings-panel" role="tabpanel" id="settings-panel-diagnostics" aria-labelledby="settings-tab-diagnostics" hidden={tab!=='diagnostics'}><Button icon="info" disabled={busy} onClick={()=>{close();window.setTimeout(requestAbout,0);}}>关于 AVHub</Button><Diagnostics/></div>
      {scanning && <p role="status">后台扫描正在进行，可关闭设置继续观看。扫描结束后可修改目录。</p>}
  </Dialog>;
}
