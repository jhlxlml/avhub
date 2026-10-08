import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, checkServiceBuild, json, duration, errorText, views, type View, type Media, type MediaUpdate, type Root, type MediaPage, type PlaylistSource } from './api';
import { Settings } from './Settings';
import {AboutHost} from './AppTools';
import { Diagnostics } from './Diagnostics';
import { Button, EmptyState, StatusMessage, Toast } from './ui';
import { episodeLabel, formatLabel,fileSizeLabel,resolutionTiers,resolutionDisplayLabel } from './mediaLabels';
import { Playlists } from './Playlists';
import { Pagination } from './Pagination';
import { DirectoryFilter } from './DirectoryFilter';
import {DirectoryTree} from './DirectoryTree';
import { FolderBrowser } from './FolderBrowser';
import { HoverPreview, loadPreviewPreference } from './HoverPreview';
import { ScanProgress, ScanRecovery, useScan } from './ScanProgress';
import { ThumbnailTasks, useThumbnails } from './ThumbnailTasks';
import { initializePreferences, savePreference, flushPreferences,preference } from './preferences';
import { useWatchRouter } from './watchRouter';
import { MediaActions } from './MediaActions';
import {MediaEditDialog} from './MediaEditDialog';
import {LibraryEmptyState} from './LibraryEmptyState';
import {LibraryFilters} from './LibraryFilters';
import {LibraryHeading} from './LibraryHeading';
import { Icon, type IconName } from './Icon';
import { WindowChrome } from './WindowChrome';
import { resetPlaybackWindow } from './windowMode';
import { MediaThumbnail } from './MediaThumbnail';
import { BulkEditor } from './BulkEditor';
import { SeriesLibrary } from './SeriesLibrary';
import { pageScrollTop, scrollPageTo } from './pageScroll';
import { initializeAppearance } from './appearance';
import { initializeAutoplay } from './autoplay';
import { initializeNativePreparation } from './nativePreparation';
import { CoverSizeControl, ThemeToggle } from './AppearanceControls';
import { AutoScrollbars } from './AutoScrollbars';
import {LibraryPageCache,useLibraryQuery} from './useLibraryQuery';
import {librarySorts,sortField,isAscending,validSort} from './librarySort';
import {ResolutionBadge} from './ResolutionBadge';
import './styles.css';
import './library-performance.css';
import './design-system.css';
import './appearance.css';
import './scrollbars.css';
import './playlists.css';

const Player = lazy(() => import('./Player').then(module => ({ default: module.Player })));

const formats = ['mp4','mkv','avi','mov','m4v','webm','wmv','flv','ts','mts','m2ts'];
const viewIcons:Record<View,IconName>={all:'library',movies:'film',series:'series',continue:'continue',favorites:'favorite',history:'history'};
type Filters = { view: View; root: string; folder: string; recursive: boolean; q: string; layout: 'grid' | 'list'; sort: string; page: number; pageSize: number;
  format: string; resolution: string; watch: 'all' | 'watched' | 'unwatched'; duration: '' | 'short' | 'medium' | 'long'; grouped: boolean; show: string; season: string };
function readFilters(): Filters {
  const p = new URLSearchParams(location.search);
  const candidate = p.get('view') || (p.get('favorites') === '1' ? 'favorites' : 'all');
  const savedSort=preference<string>('librarySort','added');
  return { view: views.some(x => x.id === candidate) ? candidate as View : 'all',
    grouped: p.get('grouped') === 'true', show: /^\d+$/.test(p.get('show') || '') ? p.get('show')! : '',
    season: /^(unknown|\d+)$/.test(p.get('season') || '') ? p.get('season')! : '',
    root: /^\d+$/.test(p.get('root') || '') ? p.get('root')! : '',
    folder: /^\d+$/.test(p.get('root') || '') ? p.get('folder') || '' : '',
    recursive: !p.get('root') || p.get('recursive') !== 'false', q: p.get('q') || '',
    layout: p.get('layout') === 'list' ? 'list' : 'grid',
    sort: validSort(p.get('sort')) ? p.get('sort')! : validSort(savedSort)?savedSort:'added',
    format: formats.includes(p.get('format') || '') ? p.get('format')! : '',
    resolution: resolutionTiers.some(t=>t===p.get('resolution')) ? p.get('resolution')! : '',
    watch: ['all','watched','unwatched'].includes(p.get('watch') || '') ? p.get('watch') as Filters['watch'] : 'all',
    duration: ['short','medium','long'].includes(p.get('duration') || '') ? p.get('duration') as Filters['duration'] : '',
    page: /^\d+$/.test(p.get('page') || '') ? Math.max(1, Math.min(10000000, Number(p.get('page')))) : 1,
    pageSize: [24,48,96].includes(Number(p.get('pageSize'))) ? Number(p.get('pageSize')) : 48 };
}
function historyTime(value?: number) {
  if (!value) return '';
  const date = new Date(value * 1000);
  const today = new Date();
  const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const timestamp = date.getTime();
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (timestamp >= dayStart) return `今天 ${time}`;
  if (timestamp >= dayStart - 86400000) return `昨天 ${time}`;
  return `${date.toLocaleDateString()} ${time}`;
}

const NO_MEDIA:Media[]=[];
function mediaQuery(filters:Filters) {
  const params=new URLSearchParams({view:filters.view==='favorites'?'all':filters.view,q:filters.q});
  if(filters.view==='favorites')params.set('favorite','true');
  if(filters.root)params.set('root_id',filters.root);
  if(filters.folder)params.set('folder',filters.folder);
  if(!filters.recursive)params.set('recursive','false');
  if(filters.format)params.set('format_ext',filters.format);
  if(filters.watch!=='all')params.set('watch_status',filters.watch);
  if(filters.duration)params.set('duration_band',filters.duration);
  if(filters.resolution)params.set('resolution',filters.resolution);
  params.set('page',String(filters.page));params.set('page_size',String(filters.pageSize));params.set('sort',filters.sort);
  return '/api/media?'+params;
}

function App() {
  const [filters, setFilters] = useState(readFilters);
  const [treeOpen,setTreeOpen]=useState(false);
  useEffect(()=>{savePreference('librarySort',filters.sort);},[filters.sort]);
  const [advancedOpen, setAdvancedOpen] = useState(() => {
    const initial = readFilters(); return Boolean(initial.format || initial.watch !== 'all' || initial.duration);
  });
  const [libraryCache]=useState(()=>new LibraryPageCache());
  const [rootsReady,setRootsReady]=useState(false);
  const [roots, setRoots] = useState<Root[]>([]);
  const [selected, setSelected] = useState<Media | null>(null);
  const [automaticMedia, setAutomaticMedia] = useState<number|null>(null);
  const [settings, setSettings] = useState(false);
  const [playlistsOpen, setPlaylistsOpen] = useState(false);
  const [playlistTarget, setPlaylistTarget] = useState<Media | null>(null);
  const [editingMedia,setEditingMedia]=useState<Media|null>(null);
  const [playlistBatch,setPlaylistBatch]=useState<number[]|null>(null);
  const [queue, setQueue] = useState<PlaylistSource | null>(null);
  const [searchOpen, setSearchOpen] = useState(() => Boolean(readFilters().q));
  const [notification, setNotification] = useState({message:'', autoDismissMs:0, id:0});
  const notice = notification.message;
  const setNotice = useCallback((message:string) => {
    setNotification(current => ({message, autoDismissMs:0, id:current.id+1}));
  }, []);
  const playlistAdded = useCallback((message:string) => {
    // A fresh identity restarts the timer even when the same video is added again.
    setNotification(current => ({message, autoDismissMs:4000, id:current.id+1}));
  }, []);
  const [revision, setRevision] = useState(0);
  const [libraryRetry,setLibraryRetry]=useState(0);
  const [bulkMode, setBulkMode] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const grouped = filters.view === 'series' && filters.grouped;
  const library=useLibraryQuery<MediaPage>(grouped||!rootsReady||selected?null:mediaQuery(filters),revision,libraryCache,filters.q,libraryRetry);
  const items=library.data?.items??NO_MEDIA,total=library.data?.total??0;
  const loading=!rootsReady||library.loading,requestError=library.error;
  const reportedStartup=useRef(false);
  useEffect(()=>{
    if(!reportedStartup.current && rootsReady && library.data && !loading && !requestError) {
      reportedStartup.current=true;
      void window.avhubDesktop?.startupReady?.().catch(()=>{});
    }
  },[rootsReady,loading,requestError,library.data]);
  const setItems=useCallback((change:(value:Media[])=>Media[])=>library.update(value=>value?{...value,items:change(value.items)}:value),[library.update]);
  useEffect(() => { setPicked([]); setBulkMode(false); }, [filters.view, filters.root, filters.folder, filters.recursive, filters.q, filters.format, filters.watch, filters.duration, filters.resolution, grouped]);
  function pick(ids: number[]) {
    setPicked(current => { const next = [...new Set([...current, ...ids])];
      if (next.length > 500) { setNotice('每批最多选择 500 个视频，请先整理当前选择'); return current; }
      return next;
    });
  }
  const [favoritePending, setFavoritePending] = useState<number[]>([]);
  const favoriteLocks = useRef(new Set<number>());
  const scroll = useRef(Number(history.state?.avhubScroll)||0);
  const restore = useRef(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const [previewEnabled,setPreviewEnabled]=useState(loadPreviewPreference);
  const [previewId,setPreviewId]=useState<number|null>(null);
  const [routeLoading,setRouteLoading]=useState(false);
  const router=useWatchRouter(()=>{
    setAutomaticMedia(null);
    setFilters(readFilters());setRevision(value=>value+1);
    scroll.current=Number(history.state?.avhubScroll)||0;restore.current=true;
  });
  useEffect(()=>{savePreference('hoverPreview',previewEnabled);setPreviewId(null);},[previewEnabled]);
  useEffect(()=>{
    const failed=(event:Event)=>setNotice((event as CustomEvent<string>).detail);
    window.addEventListener('avhub-preferences-error',failed);
    return ()=>window.removeEventListener('avhub-preferences-error',failed);
  },[]);
  useEffect(()=>{setPreviewId(null);},[selected,filters.view,filters.root,filters.folder,filters.q,filters.page]);
  useEffect(()=>{
    const stop=()=>setPreviewId(null);
    window.addEventListener('blur',stop);document.addEventListener('visibilitychange',stop);
    return ()=>{window.removeEventListener('blur',stop);document.removeEventListener('visibilitychange',stop);};
  },[]);

  const reloadRoots = useCallback(async () => {
    const values = await api<Root[]>('/api/roots?check_available=false');
    setRoots(values);
    setFilters(f => f.root && !values.some(r => String(r.id) === f.root) ? { ...f, root: '', folder: '', recursive: true, page: 1 } : f);
    setRevision(x => x + 1);
  }, []);
  useEffect(() => { void reloadRoots().catch(e => setNotice(errorText(e))).finally(()=>setRootsReady(true)); }, [reloadRoots]);
  const onScanComplete = useCallback(() => { void reloadRoots().catch(e => setNotice(errorText(e))); }, [reloadRoots]);
  const onScanProgress = useCallback(() => setRevision(value => value + 1), []);
  const scan = useScan(onScanComplete, setNotice, onScanProgress);

  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.delete('favorites');
    for (const [key, value] of Object.entries(filters)) {
      if ((!value && key !== 'recursive') || (key === 'view' && value === 'all') || (key === 'watch' && value === 'all') || (key === 'layout' && value === 'grid') ||
          (key === 'recursive' && value === true) || (key === 'page' && value === 1) || (key === 'pageSize' && value === 48)) url.searchParams.delete(key);
      else if (key === 'recursive' && value === false) url.searchParams.set(key, 'false');
      else url.searchParams.set(key, String(value));
    }
    router.replaceHref(url);
  }, [filters,router.replaceHref]);
  useEffect(()=>{
    const {mediaId,playlistId}=router.route;
    if(!mediaId){setSelected(null);setQueue(null);setRouteLoading(false);void resetPlaybackWindow().catch(e=>setNotice(errorText(e)));return;}
    const controller=new AbortController();setRouteLoading(true);
    void (async()=>{
      const media=await api<Media>(`/api/media/${mediaId}`,{signal:controller.signal});
      let source:PlaylistSource|null=null;
      if(playlistId) {
        try {const list=await api<{id:number;name:string}>(`/api/playlists/${playlistId}/queue?media_id=${mediaId}&page_size=40`,{signal:controller.signal});source={id:list.id,name:list.name};}
        catch(e){if(controller.signal.aborted)return;setNotice(`片单上下文无法恢复：${errorText(e)}。已改为普通播放。`);router.navigate(mediaId,null,true);}
      }
      if(!controller.signal.aborted){scroll.current=router.route.scroll;setQueue(source);setSelected(media);scrollPageTo(0);}
    })().catch(e=>{if(!controller.signal.aborted){setNotice(`无法恢复播放页：${errorText(e)}`);router.navigate(null,null,true);restore.current=true;}})
      .finally(()=>{if(!controller.signal.aborted)setRouteLoading(false);});
    return ()=>controller.abort();
  },[router.route.mediaId,router.route.playlistId]);

  useEffect(()=>{
    if(library.data&&library.data.page!==filters.page)setFilters(f=>({...f,page:library.data!.page}));
  },[library.data,filters.page]);

  const updateMedia = useCallback((value: MediaUpdate) => {
    setEditingMedia(current=>current?.id===value.id?{...current,...value}:current);
    libraryCache.clear();
    setItems(current => current.map(m => m.id === value.id ? { ...m, ...value } : m));
    setSelected(current => current?.id === value.id ? { ...current, ...value } : current);
    setRevision(current=>current+1);
  }, [libraryCache,setItems]);
  const refreshThumbnails=useCallback(()=>{
    const ids=selected?String(selected.id):items.map(item=>item.id).join(',');
    if(ids)void api<{id:number;thumbnail_url?:string|null}[]>(`/api/thumbnails/versions?ids=${ids}`).then(values=>{
      const covers=new Map(values.map(value=>[value.id,value.thumbnail_url??undefined]));
      libraryCache.clear();
      setItems(current=>current.map(item=>covers.has(item.id)?{...item,thumbnail_url:covers.get(item.id)}:item));
      setSelected(current=>current&&covers.has(current.id)?{...current,thumbnail_url:covers.get(current.id)}:current);
    }).catch(()=>{});
    window.dispatchEvent(new Event('avhub-thumbnails-published'));
  },[selected?.id,items]);
  const thumbnails=useThumbnails(refreshThumbnails,selected?String(selected.id):grouped?'':items.map(item=>item.id).join(','));
  async function changeFavorite(m: Media) {
    if (favoriteLocks.current.has(m.id)) return;
    favoriteLocks.current.add(m.id); setFavoritePending([...favoriteLocks.current]);
    try {
      const value=await api<Media>(`/api/media/${m.id}/favorite`, json('PUT', { favorite: !m.favorite }));
      // A favorite write changes no image or playback source. Keep this page's
      // mounted cards/preview while invalidating other classifications.
      libraryCache.clear();
      library.update(current=>{
        if(!current)return current;
        const old=current.items.find(item=>item.id===value.id);
        const total=filters.view==='favorites'&&old?.favorite&&!value.favorite?Math.max(0,current.total-1):current.total;
        return {...current,total,pages:Math.max(1,Math.ceil(total/current.page_size)),items:current.items.map(item=>item.id===value.id?{...item,favorite:value.favorite}:item)};
      });
      setSelected(current=>current?.id===value.id?{...current,favorite:value.favorite}:current);
      // Removing a favorite may require filling/clamping a page. Revalidate
      // against the server without changing the current query identity.
      if (!selected && filters.view === 'favorites') setLibraryRetry(x => x + 1);
    }
    catch (e) { setNotice(errorText(e)); }
    finally { favoriteLocks.current.delete(m.id); setFavoritePending([...favoriteLocks.current]); }
  }
  async function clearHistory(m: Media) {
    try {
      await api(`/api/media/${m.id}/history`, { method: 'DELETE' });
      setNotice(`已清除“${m.title}”的观看记录`);
      setRevision(value => value + 1);
    } catch (e) { setNotice(errorText(e)); }
  }
  function open(m: Media) {scroll.current=pageScrollTop();setAutomaticMedia(null);setQueue(null);setSelected(m);router.navigate(m.id);scrollPageTo(0);}
  function playQueue(source: PlaylistSource, media: Media) {
    scroll.current = pageScrollTop();
    setAutomaticMedia(null);setQueue(source);setSelected(media);router.navigate(media.id,source.id);setPlaylistsOpen(false);setPlaylistTarget(null);scrollPageTo(0);
  }
  function playQueueItem(m: Media, automatic=false) {
    setAutomaticMedia(automatic?m.id:null);setSelected(m);router.navigate(m.id,queue?.id||null,true);
  }
  function toggleSearch() {
    setSearchOpen(open => !open);
    if (!searchOpen) requestAnimationFrame(() => searchInput.current?.focus());
  }
  function close() {
    setAutomaticMedia(null);restore.current=true;router.close();
  }
  useLayoutEffect(() => {
    if (!selected && !loading && restore.current) { scrollPageTo(scroll.current); restore.current = false; }
  }, [selected, loading]);

  const visible = items.filter(m => (filters.view !== 'favorites' || m.favorite) && (filters.view !== 'continue' || (m.progress > 0 && !m.watched)));
  const displayTotal = Math.max(0, total - (items.length - visible.length));
  const pages = Math.max(1, Math.ceil(displayTotal / filters.pageSize));
  function changePage(page: number) { setFilters(f => ({ ...f, page })); scrollPageTo(0); }
  const title = views.find(v => v.id === filters.view)!.label;
  const filterSummary=<LibraryFilters value={filters} roots={roots} grouped={grouped} change={change=>{
    setFilters(f=>({...f,...change,page:1}));
    if('q' in change&&'format' in change&&'root' in change)setAdvancedOpen(false);
  }}/>;
  return <>
    {notice && <Toast key={notification.id} message={notice} autoDismissMs={notification.autoDismissMs} close={() => setNotice('')}>{notice.startsWith('设置尚未保存') && <Button icon="refresh" onClick={()=>{setNotice('');void flushPreferences();}}>重试保存设置</Button>}</Toast>}
    {router.route.mediaId && (!selected || selected.id!==router.route.mediaId) && <div className="player-loading"><StatusMessage kind="loading">正在恢复播放页…</StatusMessage></div>}
    {selected && selected.id===router.route.mediaId && <Suspense fallback={<div className="player-loading"><StatusMessage kind="loading">正在打开播放器…</StatusMessage></div>}>
      <Player key={selected.id} media={selected} automatic={automaticMedia===selected.id} close={close} playNext={playQueueItem} queue={queue || undefined} update={updateMedia}
        favoriteBusy={favoritePending.includes(selected.id)} changeFavorite={changeFavorite} registerNavigationGuard={router.registerGuard} notify={setNotice} />
    </Suspense>}
    <main hidden={Boolean(router.route.mediaId)||routeLoading}>
      <header>
        <div className="brand"><span className="logo"><Icon name="play" size={20}/></span><div><b>AVHub</b><small>本地视频库</small></div></div>
        <nav className="primary-nav" aria-label="视频分类">{views.map(v => <button key={v.id}
          className={filters.view === v.id ? 'active' : ''} aria-pressed={filters.view === v.id}
          onClick={() => setFilters(f => ({ ...f, view: v.id, show: '', season: '', page: 1, ...(v.id === 'series' && f.grouped ? {folder:'',recursive:true,format:'',resolution:'',watch:'all' as const,duration:'' as const} : {}) }))}><Icon name={viewIcons[v.id]} size={16}/>{v.label}</button>)}
          <button className="playlist-nav" aria-label="播放列表" onClick={() => setPlaylistsOpen(true)}><Icon name="playlist" size={16}/>播放列表</button></nav>
        <div className="header-actions">
          <div className={`header-search${searchOpen ? ' expanded' : ''}`}>
            <button className={`search-toggle${filters.q ? ' has-query' : ''}`} aria-label={searchOpen ? '收起搜索' : filters.q ? '搜索（已启用）' : '搜索视频'}
              title={filters.q ? '搜索条件已启用' : '搜索视频'} onClick={toggleSearch}>
              <Icon name="search"/><i aria-hidden="true" />
            </button>
            {searchOpen && <div className="search"><input ref={searchInput} aria-label="搜索视频" value={filters.q} placeholder={grouped ? '搜索剧名…' : '搜索名称、标签或文件名…'}
              onChange={e => setFilters(f => ({ ...f, q: e.target.value, show: '', season: '', page: 1 }))} />
              {filters.q && <button className="search-clear" aria-label="清空搜索" onClick={() => setFilters(f => ({ ...f, q: '', page: 1 }))}><Icon name="close" size={15}/></button>}</div>}
          </div>
          <ScanRecovery job={scan.job} resume={scan.resume} />
          <ThumbnailTasks status={thumbnails.status} changed={thumbnails.changed}/>
          <button className="ui-button refresh-library" onClick={() => void scan.start()} disabled={scan.scanning}><Icon name="refresh" className={scan.scanning?'is-spinning':''}/><span>{scan.scanning ? '正在扫描…' : '刷新媒体库'}</span></button>
          <ThemeToggle/>
          <button className="ui-icon-button" aria-label="媒体库设置" title="媒体库设置" onClick={() => setSettings(true)}><Icon name="settings"/></button></div>
      </header>
      <div className={`app-layout${treeOpen?' with-directory-tree':''}`}>
      <DirectoryTree roots={roots} root={filters.root} folder={filters.folder} revision={revision} visible={treeOpen} active={treeOpen&&!router.route.mediaId&&!routeLoading}
        close={()=>setTreeOpen(false)} select={(root,folder)=>setFilters(f=>({...f,root,folder,show:'',season:'',page:1,recursive:root?f.recursive:true,grouped:folder?false:f.grouped}))}/>
      <section className="library">
        <ScanProgress job={scan.job} cancel={scan.cancel} connectionError={scan.connectionError} />
        <div className="toolbar">
          <button className="ui-icon-button" aria-label={treeOpen?'隐藏目录树':'显示目录树'} aria-pressed={treeOpen} title={treeOpen?'隐藏目录树':'显示目录树'} onClick={()=>setTreeOpen(open=>!open)}><Icon name="folder"/></button>
          <DirectoryFilter roots={roots} value={filters.root} change={root => setFilters(f => ({ ...f, root, folder: '', show: '', season: '', recursive: true, page: 1 }))} />
          {filters.view === 'series' && <Button icon="series" aria-pressed={grouped} onClick={() => setFilters(f => ({...f, grouped: !grouped, show: '', season: '', folder: '', recursive: true, format: '', resolution: '', watch: 'all', duration: '', page: 1}))}>{grouped ? '按视频浏览' : '按剧集归类'}</Button>}
          {!grouped && <><div className="library-sort-controls"><select className="sort-select" aria-label="排序方式" value={sortField(filters.sort).id} onChange={e => {
            const field=librarySorts.find(s=>s.id===e.target.value)!;
            setFilters(f=>({...f,sort:isAscending(f.sort)?field.asc:field.desc,page:1}));
          }}>
            {librarySorts.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <button className="ui-icon-button sort-direction" aria-label={isAscending(filters.sort)?'切换为降序':'切换为升序'}
            title={`${isAscending(filters.sort)?'升序':'降序'} · ${isAscending(filters.sort)?sortField(filters.sort).ascending:sortField(filters.sort).descending}（点击切换）`}
            onClick={()=>setFilters(f=>({...f,sort:isAscending(f.sort)?sortField(f.sort).desc:sortField(f.sort).asc,page:1}))}>
            <Icon name={isAscending(filters.sort)?'sortAsc':'sortDesc'} size={18}/>
          </button></div>
          <button className={`advanced-toggle toolbar-icon-action${filters.format || filters.watch !== 'all' || filters.duration ? ' active' : ''}`} aria-expanded={advancedOpen}
            aria-label={`更多筛选${filters.format || filters.watch !== 'all' || filters.duration ? ' · 已启用' : ''}`} title={`更多筛选${filters.format || filters.watch !== 'all' || filters.duration ? ' · 已启用' : ''}`}
            onClick={() => setAdvancedOpen(value => !value)}><Icon name="filter" size={16}/><span className="toolbar-action-label">更多筛选{filters.format || filters.watch !== 'all' || filters.duration ? ' · 已启用' : ''}</span></button>
          <Button icon="edit" className="toolbar-icon-action" aria-label="批量整理" title="批量整理" aria-pressed={bulkMode} onClick={() => { setBulkMode(value => !value); setPicked([]); }}><span className="toolbar-action-label">批量整理</span></Button>
          </>}
          <div className="library-toolbar-right">
          {!grouped&&<div className="resolution-filter" role="group" aria-label="分辨率筛选">
            <span className="resolution-filter-label" title="分辨率"><Icon name="resolution" size={18}/></span>
            {['',...resolutionTiers].map(tier=><button key={tier} type="button" aria-label={tier?`筛选 ${resolutionDisplayLabel(tier)}`:'全部分辨率'}
              aria-pressed={filters.resolution===tier} title={tier?'按源视频短边分级':'显示所有分辨率，包括未知'}
              onClick={()=>setFilters(f=>({...f,resolution:tier,page:1}))}>{tier?resolutionDisplayLabel(tier):'ALL'}</button>)}
          </div>}
          {!grouped&&<label className="resolution-compact" title="分辨率"><Icon name="resolution" size={18}/><select aria-label="按分辨率筛选" value={filters.resolution} onChange={event=>setFilters(f=>({...f,resolution:event.target.value,page:1}))}>
            <option value="">ALL</option>{resolutionTiers.map(tier=><option key={tier} value={tier}>{resolutionDisplayLabel(tier)}</option>)}
          </select></label>}
          <div className="library-view-controls"><CoverSizeControl disabled={!grouped&&filters.layout==='list'}/>
          {!grouped&&<div className="switch">{(['grid','list'] as const).map(layout => <button key={layout} aria-label={layout === 'grid' ? '封面墙' : '列表'}
            aria-pressed={filters.layout===layout} title={layout==='grid'?'封面墙':'列表'} className={filters.layout === layout ? 'active' : ''} onClick={() => setFilters(f => ({ ...f, layout }))}><Icon name={layout==='grid'?'grid':'list'} size={17}/></button>)}</div>}</div>
          </div>
        </div>
        {grouped ? <SeriesLibrary cache={libraryCache} active={rootsReady&&!selected} q={filters.q} root={filters.root} show={filters.show} season={filters.season} page={filters.page} pageSize={filters.pageSize} revision={revision}
          filterSummary={filterSummary} change={change => setFilters(f => ({...f, ...change, ...(change.show ? {q: ''} : {})}))} play={open}/> : <>
        {bulkMode && <div className="bulk-selection-bar" aria-label="批量选择"><span>已选 {picked.length} / 500 · 支持跨页选择</span>
          <Button disabled={loading} onClick={() => pick(visible.map(m => m.id))}>选中本页</Button>
          <Button disabled={!picked.length} onClick={() => setPicked([])}>清空选择</Button>
          <Button icon="edit" variant="primary" disabled={!picked.length} onClick={() => setBulkOpen(true)}>编辑所选</Button><Button icon="playlist" disabled={!picked.length} onClick={()=>setPlaylistBatch([...picked])}>所选加入播放列表</Button></div>}
        {roots.find(root => String(root.id) === filters.root) && <FolderBrowser key={filters.root} root={roots.find(root => String(root.id) === filters.root)!}
          folder={filters.folder} recursive={filters.recursive} revision={revision} treeMode={treeOpen} change={folder => setFilters(f => ({ ...f, folder, page: 1 }))}
          changeRecursive={recursive => setFilters(f => ({ ...f, recursive, page: 1 }))} />}
        {advancedOpen && <div className="advanced-filters" aria-label="高级筛选">
          <label>视频格式<select aria-label="视频格式" value={filters.format} onChange={event => setFilters(f => ({ ...f, format: event.target.value, page: 1 }))}>
            <option value="">全部格式</option>{formats.map(format => <option key={format} value={format}>{formatLabel(format)}</option>)}
          </select></label>
          <label>观看状态<select aria-label="观看状态" value={filters.watch} onChange={event => setFilters(f => ({ ...f, watch: event.target.value as Filters['watch'], page: 1 }))}>
            <option value="all">全部状态</option><option value="unwatched">未看完</option><option value="watched">已看完</option>
          </select></label>
          <label>视频时长<select aria-label="视频时长范围" value={filters.duration} onChange={event => setFilters(f => ({ ...f, duration: event.target.value as Filters['duration'], page: 1 }))}>
            <option value="">不限时长</option><option value="short">短片 · 30 分钟内</option><option value="medium">中等 · 30–90 分钟</option><option value="long">长片 · 90 分钟以上</option>
          </select></label>
          {(filters.format || filters.watch !== 'all' || filters.duration || filters.resolution) && <button className="filter-reset" onClick={() => setFilters(f => ({ ...f, format: '', resolution: '', watch: 'all', duration: '', page: 1 }))}>清除筛选</button>}
        </div>}
        <LibraryHeading title={title} filters={filterSummary} count={library.data?`共 ${displayTotal} 个结果 · 本页 ${visible.length} 个`:library.showLoading?'正在加载…':''}
          updating={Boolean(library.data&&library.showLoading)}/>
        {requestError&&library.data&&<StatusMessage kind="error">{requestError}<Button icon="refresh" onClick={()=>setRevision(x=>x+1)}>重试</Button></StatusMessage>}
        {requestError&&!library.data ? <div className="empty"><StatusMessage kind="error">{requestError}</StatusMessage><Button icon="refresh" onClick={() => setRevision(x => x + 1)}>重试</Button></div> :
          loading&&!library.data ? <div className="library-query-placeholder" aria-busy="true" aria-label="视频列表载入中">{library.showLoading&&<StatusMessage kind="loading">正在加载视频…</StatusMessage>}</div> :
            visible.length ? <div className={`media-${filters.layout}`}>{visible.map(m => <article className={`card${picked.includes(m.id) ? ' selected' : ''}`} key={m.id}>
            <div className="cover" onPointerEnter={event=>{if(previewEnabled && !selected && event.pointerType==='mouse')setPreviewId(m.id);}} onPointerLeave={()=>setPreviewId(null)}>
              {bulkMode && <label className="bulk-pick"><input type="checkbox" aria-label={`选择 ${m.title}`} checked={picked.includes(m.id)} onChange={event => event.target.checked ? pick([m.id]) : setPicked(current => current.filter(id => id !== m.id))}/></label>}
              <button className="open-video" aria-label={`播放 ${m.title}`} onClick={() => open(m)}>
                <MediaThumbnail url={m.thumbnail_url} retryKey={revision}/>
                {previewEnabled && previewId===m.id && !selected && <HoverPreview key={m.id} media={m} />}
              </button>
              <button className="star" aria-label={m.favorite ? `取消收藏 ${m.title}` : `收藏 ${m.title}`} aria-pressed={Boolean(m.favorite)}
                title={m.favorite?'取消收藏':'收藏'} disabled={favoritePending.includes(m.id)} onClick={() => void changeFavorite(m)}><Icon name="favorite" size={16} filled={Boolean(m.favorite)}/></button>
              <button className="queue-add" aria-label={`加入播放列表 ${m.title}`} title="加入播放列表" onClick={() => setPlaylistTarget(m)}><Icon name="plus" size={17}/></button>
              {filters.view === 'history' && <button className="history-remove" aria-label={`清除观看历史 ${m.title}`} title="清除观看记录" onClick={() => void clearHistory(m)}><Icon name="close" size={16}/></button>}
              <span className="duration">{duration(m.duration)}</span>
              {m.progress > 0 && <div className="progress"><i style={{ width: `${Math.min(100, m.progress / (m.duration || 1) * 100)}%` }} /></div>}
            </div>
            <div className="card-footer"><div className="meta"><button className="video-title" title={m.title} onClick={() => open(m)}>{m.title}</button>
              <div className="video-specs"><ResolutionBadge width={m.width} height={m.height}/><span className="video-spec-text">{formatLabel(m.ext)}{fileSizeLabel(m.size)&&` · ${fileSizeLabel(m.size)}`}</span></div>
              {(m.watched||m.kind==='episode'||filters.view==='history')&&<span className="video-context">{m.watched && filters.view!=='history'?<><Icon name="check" size={12}/> 已看{m.kind==='episode'?' · ':''}</>:null}{filters.view === 'history' ? `${historyTime(m.last_played)} · ${m.watched ? '已看完' : `看到 ${duration(m.progress)}`}` :
                m.kind === 'episode' ? episodeLabel(m) : null}</span>}</div>
              <MediaActions media={m} update={updateMedia} changed={()=>setRevision(value=>value+1)} notify={setNotice} edit={()=>setEditingMedia(m)}/></div>
            </article>)}</div> : <LibraryEmptyState roots={roots} root={filters.root} view={filters.view} icon={viewIcons[filters.view]}
              filtered={Boolean(filters.q||filters.folder||filters.format||filters.resolution||filters.watch!=='all'||filters.duration)} scanning={scan.scanning} scanState={scan.job?.state}
              add={()=>setSettings(true)} scan={()=>void scan.start(filters.root?Number(filters.root):undefined)}
              clear={()=>setFilters(f=>({...f,root:'',folder:'',recursive:true,q:'',view:'all',format:'',resolution:'',watch:'all',duration:'',page:1}))}/>}
        {!requestError&&library.data && <Pagination page={filters.page} pages={pages} total={displayTotal} pageSize={filters.pageSize} busy={loading}
          changePage={changePage} changeSize={pageSize => { setFilters(f => ({ ...f, pageSize, page: 1 })); scrollPageTo(0); }} />}
        </>}
      </section></div>
      {bulkOpen && <BulkEditor ids={picked} close={() => setBulkOpen(false)} done={count => { setBulkOpen(false); setPicked([]); setRevision(value => value + 1); setNotice(`已整理 ${count} 个视频，源文件未修改`); }}/ >}
      {editingMedia&&<MediaEditDialog media={editingMedia} update={updateMedia} close={()=>setEditingMedia(null)}/>}
      {settings && <Settings roots={roots} close={() => setSettings(false)} reload={reloadRoots} scanning={scan.scanning} scan={scan.start} previewEnabled={previewEnabled} changePreview={setPreviewEnabled} thumbnailStatus={thumbnails.status} changeThumbnailStatus={thumbnails.changed} />}
      {playlistsOpen && <Playlists close={() => setPlaylistsOpen(false)} play={playQueue} added={playlistAdded} />}
      {playlistTarget && <Playlists addMedia={playlistTarget} close={() => setPlaylistTarget(null)} play={playQueue} added={playlistAdded} />}
      {playlistBatch&&<Playlists addMediaIds={playlistBatch} close={()=>setPlaylistBatch(null)} play={playQueue} added={message=>{setPicked([]);playlistAdded(message);}}/>}
    </main>
  </>;
}

function Startup() {
  const [ready,setReady]=useState(false);
  const [error,setError]=useState('');
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    let active=true;setError('');
    void checkServiceBuild().then(initializePreferences).then(()=>{if(active){initializeAppearance();initializeAutoplay();initializeNativePreparation();setReady(true);}}).catch(e=>{if(active)setError(errorText(e));});
    return ()=>{active=false;};
  },[attempt]);
  if(ready)return <App/>;
  return <div className="empty" role={error?'alert':'status'}>{error||'正在载入本地设置…'}{error&&<><button onClick={()=>setAttempt(value=>value+1)}>重试启动</button><Diagnostics/></>}</div>;
}
createRoot(document.getElementById('root')!).render(<><AutoScrollbars/><WindowChrome/><AboutHost/><div id="app-scroll-area"><Startup/></div></>);
