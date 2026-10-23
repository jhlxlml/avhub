import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, json, errorText, type Root } from './api';
import {BackupTools} from './BackupTools';
import {StorageTools} from './StorageTools';
import {MissingArtworkTools} from './MissingArtworkTools';
import './settings.css';
import { Icon, type IconName } from './Icon';
import { Button, Dialog, DialogHeader, StatusMessage } from './ui';
import { Diagnostics } from './Diagnostics';
import { type ThumbnailStatus } from './ThumbnailTasks';
import { ScreenshotSettings } from './ScreenshotSettings';
import { AutoplaySettings } from './AutoplaySettings';
import { NativePrepareSettings } from './NativePrepareSettings';
import {ResumeBehaviorSettings} from './ResumeBehaviorSettings';
import {MouseSeekSettings} from './MouseSeekSettings';
import {AppDataTools} from './AppTools';
import {HelpPanel} from './HelpPanel';
import {requireDesktop} from './nativeDesktop';
import {useDraftGuard} from './useDraftGuard';
import {ThumbnailSummary} from './ThumbnailSummary';
import {confirmInApp} from './AppConfirm';
import {desktopFile,FileOperationHistory,FileStatePanel,type FilePermission} from './FileManagement';
import {SourceChanges} from './SourceChanges';
import {NativePlayerSettings} from './NativePlayerSettings';
import {DirectorySettingRow} from './DirectorySettingRow';
import {SettingToggle} from './SettingToggle';

const tabs:{id:string;label:string;icon:IconName}[]=[{id:'directories',label:'媒体目录',icon:'folder'},{id:'playback',label:'播放偏好',icon:'play'},{id:'data',label:'数据管理',icon:'database'},{id:'diagnostics',label:'运行诊断',icon:'activity'},{id:'help',label:'帮助',icon:'help'}];

export function Settings({ roots, close, reload, scanning, scan, previewEnabled, changePreview,thumbnailStatus,changeThumbnailStatus }: { roots: Root[]; close: () => void; reload: () => Promise<void>; scanning: boolean; scan: (root?: number) => Promise<void>; previewEnabled:boolean; changePreview:(enabled:boolean)=>void;thumbnailStatus:ThumbnailStatus|null;changeThumbnailStatus:(value:ThumbnailStatus)=>void }) {
  const [tab,setTab]=useState('directories');
  const content=useRef<HTMLDivElement>(null);
  // Keep mounted panels/drafts, but don't carry a previous category's scroll
  // offset into a different page. No focus stealing or preference writes.
  useLayoutEffect(()=>{if(content.current)content.current.scrollTop=0;},[tab]);
  const [verticalTabs,setVerticalTabs]=useState(()=>window.matchMedia('(min-width:820px)').matches);
  useEffect(()=>{const media=window.matchMedia('(min-width:820px)');const update=()=>setVerticalTabs(media.matches);update();media.addEventListener('change',update);return()=>media.removeEventListener('change',update);},[]);
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeError, setNoticeError] = useState(false);
  const [rootQuery, setRootQuery] = useState('');
  const [rootPage, setRootPage] = useState(1);
  const [availability, setAvailability] = useState<Record<number, boolean>>({});
  const [screenshotDirty,setScreenshotDirty]=useState(false),[addedRoot,setAddedRoot]=useState<Root|null>(null);
  const [mouseDirty,setMouseDirty]=useState(false);
  const [filePermissions,setFilePermissions]=useState<Record<number,FilePermission>>({});
  const directoryAction=useRef(false),permissionEpoch=useRef(0),latestPermissions=useRef(filePermissions);
  latestPermissions.current=filePermissions;
  const [permissionError,setPermissionError]=useState(''),[statusError,setStatusError]=useState('');
  const [permissionLoading,setPermissionLoading]=useState(false),[statusLoading,setStatusLoading]=useState(false);
  const [permissionRetry,setPermissionRetry]=useState(0),[statusRetry,setStatusRetry]=useState(0);
  const drafts=[screenshotDirty?'截图目录':'',mouseDirty?'鼠标侧键时长':'',path.trim()?'待添加目录':''].filter(Boolean);
  useDraftGuard(drafts.length>0,busy,`${drafts.join('、')}尚未保存，放弃修改并关闭设置吗？`);
  const requestClose=async()=>{if(!busy&&(!drafts.length||await confirmInApp('放弃未保存的修改？',drafts.join('、'),'关闭后这些修改不会保存。','放弃修改',true)))close();};
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
  const rootIdentity=JSON.stringify(shownRoots.map(root=>[root.id,root.path]));
  useEffect(()=>{
    if(!statusIds||tab!=='directories')return;
    const controller=new AbortController(),epoch=++permissionEpoch.current;setPermissionError('');setPermissionLoading(true);
    // Never present an old grant as current after a failed refresh.
    setFilePermissions({});
    void api<FilePermission[]>(`/api/file-permissions?ids=${statusIds}`,{signal:controller.signal}).then(values=>{
      if(!controller.signal.aborted&&epoch===permissionEpoch.current)setFilePermissions(Object.fromEntries(values.map(value=>[value.root_id,value])));
    }).catch(e=>{if(!controller.signal.aborted&&epoch===permissionEpoch.current)setPermissionError(errorText(e));})
      .finally(()=>{if(!controller.signal.aborted&&epoch===permissionEpoch.current)setPermissionLoading(false);});
    return()=>controller.abort();
  },[statusIds,tab,rootIdentity,permissionRetry]);
  async function permission(root:Root,action:'rename'|'recycle'|'permanentDelete',enabled:boolean){
    if(!filePermissions[root.id]||busy||scanning||directoryAction.current)return;
    directoryAction.current=true;
    setBusy(true);setNotice('');setNoticeError(false);
    try{
      if(enabled&&!await confirmInApp(action==='permanentDelete'?'开启永久删除权限？':'开启文件整理权限？',root.path,action==='permanentDelete'?'仅允许回收记录中精确识别的项目永久删除，无法通过回收站恢复；每次操作仍需单独确认。不会直接删除源目录的视频。':`允许${action==='rename'?'修改真实文件名并同步标题':'移入 Windows 系统回收站或恢复原目录'}。该授权只作用于此目录，更具体的子目录授权优先；不会修改视频内容。`,'开启权限',action==='permanentDelete'))return;
      const current=latestPermissions.current[root.id];if(!current)throw new Error('目录权限正在刷新，请读取完成后重试');
      ++permissionEpoch.current;setPermissionLoading(false);
      const result=await desktopFile({action:'permissions',id:root.id,rename:action==='rename'?enabled:current.rename,recycle:action==='recycle'?enabled:current.recycle,permanentDelete:action==='permanentDelete'?enabled:current.permanentDelete===true});
      if(result.ok!==true)throw new Error('权限保存未确认，请重新读取后核对');
      setFilePermissions(value=>({...value,[root.id]:{...current,[action]:enabled}}));
    }catch(error){setNoticeError(true);setNotice(errorText(error));}finally{directoryAction.current=false;setBusy(false);}
  }
  useEffect(() => {
    if (!statusIds || tab!=='directories') return;
    const controller = new AbortController();
    setStatusError('');setStatusLoading(true);
    setAvailability({});
    void api<Root[]>(`/api/roots/status?ids=${statusIds}`, { signal: controller.signal }).then(values => {
      if (!controller.signal.aborted) setAvailability(current => ({ ...current, ...Object.fromEntries(values.map(root => [root.id, root.available === true])) }));
    }).catch(e=>{if(!controller.signal.aborted)setStatusError(errorText(e));})
      .finally(()=>{if(!controller.signal.aborted)setStatusLoading(false);});
    return () => controller.abort();
  }, [statusIds, roots, tab,statusRetry]);
  async function add(pick: boolean) {
    if (busy) return;
    setBusy(true); setNotice(''); setNoticeError(false);
    try {
      if(pick) {
        const chosen=await requireDesktop('chooseFolder').chooseFolder('media');if('cancelled' in chosen)return;
        setAddedRoot(await api<Root>('/api/roots',json('POST',{path:chosen.path})));
        setPath('');await reload();setNotice('目录已加入，点击顶栏“刷新媒体库”开始扫描');return;
      }
      const result = await api<Root>('/api/roots',json('POST', { path: path.trim() }));
      if (!('cancelled' in result)) {
        setAddedRoot(result);
        setPath(''); await reload(); setNotice('目录已加入，点击顶栏“刷新媒体库”开始扫描');
      }
    } catch (e) { setNoticeError(true); setNotice(errorText(e)); }
    finally { setBusy(false); }
  }
  async function remove(id: number) {
    if(busy||scanning||directoryAction.current)return;
    directoryAction.current=true;
    setBusy(true); setNotice(''); setNoticeError(false);
    try {
      const root=roots.find(value=>value.id===id);
      const summary=await api<{total:number}>(`/api/media?root_id=${id}&page=1&page_size=1`);
      if(!await confirmInApp('从媒体库移除目录？',`${root?.path||''}\n当前可浏览视频 ${summary.total} 个将不再出现在媒体库中。`,'已有记录保留为离线，原视频不会被删除。以后可重新添加此目录。','移除目录',true))return;
      await api(`/api/roots/${id}`, { method: 'DELETE' });if(addedRoot?.id===id)setAddedRoot(null);await reload();setNotice('目录已从媒体库移除，原视频未改变。');
    }
    catch (e) { setNoticeError(true); setNotice(errorText(e)); }
    finally { directoryAction.current=false;setBusy(false); }
  }
  async function relocate(id: number) {
    if (busy) return;
    setBusy(true); setNotice(''); setNoticeError(false);
    try {
      const chosen=await requireDesktop('chooseFolder').chooseFolder('media');if('cancelled' in chosen)return;
      await api(`/api/roots/${id}/relocate`,json('POST',{path:chosen.path}));
      await reload();setNotice('目录已重新定位，请刷新媒体库重新扫描');
    } catch (e) { setNoticeError(true); setNotice(errorText(e)); }
    finally { setBusy(false); }
  }
  useEffect(()=>{
    const quitting=(event:Event)=>{if(busy)(event as CustomEvent<Promise<unknown>[]>).detail.push(Promise.resolve(false));};
    window.addEventListener('avhub-before-quit',quitting);return()=>window.removeEventListener('avhub-before-quit',quitting);
  },[busy]);
  return <Dialog labelledBy="settings-title" describedBy="settings-description" closeLabel="关闭设置" busy={busy} close={requestClose} className="modal settings-dialog">
      <DialogHeader id="settings-title" descriptionId="settings-description" icon="settings" title="媒体库设置" description="目录默认只读，可按目录授权文件重命名和系统回收；不改视频内容。"/>
      <div className="settings-workspace">
      <div className="settings-tabs" role="tablist" aria-label="设置分类" aria-orientation={verticalTabs?'vertical':'horizontal'}>{tabs.map((item,index)=><button key={item.id} id={'settings-tab-'+item.id} role="tab" aria-selected={tab===item.id} aria-controls={'settings-panel-'+item.id} tabIndex={tab===item.id?0:-1} disabled={busy} onClick={()=>setTab(item.id)} onKeyDown={event=>{
        if(busy||!['ArrowLeft','ArrowRight','Home','End',...(verticalTabs?['ArrowUp','ArrowDown']:[])].includes(event.key))return;event.preventDefault();
        const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(['ArrowRight','ArrowDown'].includes(event.key)?1:-1)+tabs.length)%tabs.length;
        setTab(tabs[next].id);document.getElementById('settings-tab-'+tabs[next].id)?.focus();
      }}><Icon name={item.icon} size={16}/>{item.label}</button>)}</div>
      <div className="settings-content" ref={content}>
      <div className="settings-panel" role="tabpanel" id="settings-panel-directories" aria-labelledby="settings-tab-directories" hidden={tab!=='directories'}>
      <section className="settings-section" aria-label="媒体目录">
      <h3><Icon name="folder"/>媒体目录</h3>
      <form onSubmit={e => { e.preventDefault(); void add(false); }}>
        <input aria-label="目录路径" value={path} onChange={e => setPath(e.target.value)} placeholder="例如 D:\Videos" />
        <Button type="submit" variant="primary" icon="plus" disabled={busy || scanning || !path.trim()}>添加目录</Button>
      </form>
      <button className="ui-button" disabled={busy || scanning} onClick={() => void add(true)}><Icon name="folder" size={16}/>{busy ? '正在处理…' : '浏览本地文件夹'}</button>
      {addedRoot&&<StatusMessage>已添加目录：{addedRoot.path}<Button icon="refresh" disabled={busy||scanning} onClick={()=>void scan(addedRoot.id)}>现在扫描此目录</Button></StatusMessage>}
      {roots.length > 20 && <input className="root-search" type="search" aria-label="搜索已添加目录" placeholder="搜索已添加的目录…" value={rootQuery} onChange={event => { setRootQuery(event.target.value); setRootPage(1); }} />}
      {permissionLoading&&<small role="status" className="ui-field-hint">正在读取文件权限…</small>}
      {permissionError&&<StatusMessage kind="error" className="settings-read-error"><span className="settings-read-error-copy">文件权限读取失败：{permissionError}</span><Button icon="refresh" disabled={busy||scanning} onClick={()=>setPermissionRetry(value=>value+1)}>重试文件权限</Button></StatusMessage>}
      {statusLoading&&<small role="status" className="ui-field-hint">正在检查目录状态…</small>}
      {statusError&&<StatusMessage kind="error" className="settings-read-error"><span className="settings-read-error-copy">目录状态检查失败：{statusError}</span><Button icon="refresh" disabled={busy} onClick={()=>setStatusRetry(value=>value+1)}>重试目录状态</Button></StatusMessage>}
      <div className="root-list">{shownRoots.map(root => <DirectorySettingRow key={root.id} root={root} value={filePermissions[root.id]}
        offline={(availability[root.id]??root.available)===false} disabled={busy||scanning} permission={permission}
        scan={()=>void scan(root.id)} relocate={()=>void relocate(root.id)} remove={()=>remove(root.id)}/>)}</div>
      {roots.length > 20 && <div className="root-pager" aria-label="目录分页"><span>匹配 {matching.length} 个目录 · {page} / {rootPages} 页</span><button disabled={page <= 1} onClick={() => setRootPage(page - 1)}>上一页目录</button><button disabled={page >= rootPages} onClick={() => setRootPage(page + 1)}>下一页目录</button></div>}
      </section>
      <section className="settings-section thumbnail-settings" aria-label="后台封面"><div className="settings-section-heading"><h3><Icon name="camera"/>后台封面</h3>
        <Button icon={thumbnailStatus?.paused?'play':'pause'} busy={busy} onClick={()=>void toggleThumbnails()}>{thumbnailStatus?.paused?'恢复封面任务':'暂停封面任务'}</Button></div>
        <ThumbnailSummary status={thumbnailStatus}/>
        <small>播放时自动让路，不改变手动暂停设置；离开播放器或活动信号超时后恢复。</small></section>
      <section className="preview-preference"><SettingToggle label="封面悬停预览" disabled={busy} checked={previewEnabled} onChange={changePreview}
        description="停留 0.65 秒后静音预览，每次仅播放一个原片片段。不兼容时保留封面，不触发转码；开启会增加读取与解码负载。"/></section>
      </div><div className="settings-panel" role="tabpanel" id="settings-panel-playback" aria-labelledby="settings-tab-playback" hidden={tab!=='playback'}>
      <AutoplaySettings busy={busy}/>
      <NativePlayerSettings busy={busy} changeBusy={setBusy}/>
      <ResumeBehaviorSettings busy={busy} changeBusy={setBusy}/>
      <MouseSeekSettings busy={busy} changeBusy={setBusy} onDirtyChange={setMouseDirty}/>
      <ScreenshotSettings busy={busy} changeBusy={setBusy} enabled={tab==='playback'} onDirtyChange={setScreenshotDirty}/>
      <details className="settings-advanced"><summary>高级播放设置</summary><NativePrepareSettings busy={busy} changeBusy={setBusy}/></details>
      </div><div className="settings-panel" role="tabpanel" id="settings-panel-data" aria-labelledby="settings-tab-data" hidden={tab!=='data'}><AppDataTools busy={busy} enabled={tab==='data'}/><FileStatePanel busy={busy} changeBusy={setBusy} reload={reload} enabled={tab==='data'}/><SourceChanges busy={busy} changeBusy={setBusy} reload={reload} enabled={tab==='data'}/><FileOperationHistory busy={busy} changeBusy={setBusy} reload={reload} enabled={tab==='data'}/><BackupTools busy={busy} changeBusy={setBusy} scanning={scanning} reload={reload}/><StorageTools busy={busy} changeBusy={setBusy} scanning={scanning} enabled={tab==='data'}/><MissingArtworkTools busy={busy} changeBusy={setBusy} scanning={scanning} enabled={tab==='data'} reload={reload}/></div>
      {notice && <StatusMessage className="settings-message" kind={noticeError ? 'error' : 'success'}>{notice}</StatusMessage>}
      <div className="settings-panel" role="tabpanel" id="settings-panel-diagnostics" aria-labelledby="settings-tab-diagnostics" hidden={tab!=='diagnostics'}><Diagnostics changeBusy={setBusy}/></div>
      <div className="settings-panel" role="tabpanel" id="settings-panel-help" aria-labelledby="settings-tab-help" hidden={tab!=='help'}>{tab==='help'&&<HelpPanel changeBusy={setBusy} busy={busy}/>}</div>
      {scanning && <p role="status">后台扫描正在进行，可关闭设置继续观看。扫描结束后可修改目录。</p>}
      </div></div>
  </Dialog>;
}
