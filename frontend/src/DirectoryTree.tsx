import {useEffect,useMemo,useRef,useState,type KeyboardEvent} from 'react';
import {api,errorText,type Root,type FolderPage} from './api';
import {Icon} from './Icon';
import './directory-tree.css';

type Node={root:Root;folder:string;name:string;count?:number;branch:boolean;level:number};
type Shared={active:boolean;selectedRoot:string;selectedFolder:string;revision:number;expanded:Set<string>;toggle:(key:string)=>void;select:(root:string,folder:string)=>void;cache:Map<string,FolderPage>};
const nodeKey=(id:number,folder:string)=>`${id}:${folder}`;
function TreeBranch({node,shared}:{node:Node;shared:Shared}) {
  const key=nodeKey(node.root.id,node.folder),open=shared.expanded.has(key);
  const [page,setPage]=useState(1),[result,setResult]=useState<FolderPage|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[retry,setRetry]=useState(0);
  const row=useRef<HTMLDivElement>(null);
  const focusedFor=useRef('');
  useEffect(()=>{
    if(!open||!shared.active)return;
    const prefix=node.folder?node.folder+'/':'';
    const wanted=page===1&&focusedFor.current!==shared.selectedFolder&&shared.selectedRoot===String(node.root.id)&&shared.selectedFolder.startsWith(prefix)?shared.selectedFolder.slice(prefix.length).split('/')[0]:'';
    const focus=wanted&&!result?.items.some(item=>item.name===wanted)?wanted:'';
    const controller=new AbortController(),cacheKey=`${shared.revision}:${key}:${page}:${focus}`;
    const cached=shared.cache.get(cacheKey);
    if(cached){setResult(cached);setError('');setBusy(false);return;}
    setBusy(true);setError('');
    const params=new URLSearchParams({folder:node.folder,page:String(page),page_size:'40'});
    if(focus)params.set('focus',focus);
    void api<FolderPage>(`/api/roots/${node.root.id}/folders?${params}`,{signal:controller.signal}).then(value=>{
      if(controller.signal.aborted)return;
      if(focus)focusedFor.current=shared.selectedFolder;
      shared.cache.set(cacheKey,value);
      shared.cache.set(`${shared.revision}:${key}:${value.page}:`,value);
      while(shared.cache.size>128)shared.cache.delete(shared.cache.keys().next().value!);
      setResult(value);if(value.page!==page)setPage(value.page);
    }).catch(e=>{if(!controller.signal.aborted)setError(errorText(e));}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
    return()=>controller.abort();
  },[open,page,key,shared.revision,retry,node.root.id,node.folder,shared.cache,shared.active,shared.selectedRoot,shared.selectedFolder]);
  const selected=shared.selectedRoot===String(node.root.id)&&shared.selectedFolder===node.folder;
  const branch=node.branch;
  function keyboard(event:KeyboardEvent<HTMLDivElement>) {
    if(event.target!==event.currentTarget)return;
    const rows=Array.from(row.current?.closest('[role="tree"]')?.querySelectorAll<HTMLElement>('[role="treeitem"]')||[]),index=rows.indexOf(event.currentTarget);
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
      event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?rows.length-1:Math.max(0,Math.min(rows.length-1,index+(event.key==='ArrowDown'?1:-1)));rows[next]?.focus();
    } else if(event.key==='ArrowRight') {event.preventDefault();if(branch&&!open)shared.toggle(key);else if(open&&Number(rows[index+1]?.getAttribute('aria-level'))>node.level)rows[index+1]?.focus();}
    else if(event.key==='ArrowLeft') {event.preventDefault();if(open)shared.toggle(key);else row.current?.parentElement?.parentElement?.closest('li')?.querySelector<HTMLElement>(':scope > [role="treeitem"]')?.focus();}
    else if(event.key==='Enter'||event.key===' ') {event.preventDefault();shared.select(String(node.root.id),node.folder);}
  }
  return <li role="none">
    <div ref={row} role="treeitem" aria-label={node.name} aria-level={node.level} aria-selected={selected} aria-expanded={branch?open:undefined} tabIndex={0}
      className={`directory-tree-row${selected?' is-selected':''}`} title={`${node.root.path}${node.folder?' / '+node.folder:''}`}
      style={{paddingLeft:8+Math.min(node.level-1,12)*12}} onKeyDown={keyboard} onClick={()=>shared.select(String(node.root.id),node.folder)}>
      {branch?<button type="button" tabIndex={-1} className="tree-chevron" aria-label={`${open?'收起':'展开'}目录 ${node.name}`} onClick={event=>{event.stopPropagation();shared.toggle(key);}}><Icon name={open?'chevronDown':'chevronRight'} size={13}/></button>:<span className="tree-chevron"/>}
      <Icon name={node.root.available===false?'warning':'folder'} size={15}/><span className="tree-node-name">{node.name}</span>
      {(node.count??result?.video_count)!=null&&<small>{node.count??result?.video_count}</small>}
    </div>
    {open&&<ul role="group">
      {busy&&<li role="none" className="tree-message" aria-live="polite"><Icon name="refresh" className="is-spinning" size={12}/>加载目录…</li>}
      {error?<li role="none" className="tree-message tree-error"><span role="alert">{error}</span><button onClick={()=>setRetry(n=>n+1)}>重试</button></li>:!busy&&result?.items.map(item=><TreeBranch key={nodeKey(node.root.id,item.folder)} shared={shared} node={{root:node.root,folder:item.folder,name:item.name,count:item.count,branch:item.has_children!==false,level:node.level+1}}/>)}
      {!busy&&!error&&result?.total===0&&<li role="none" className="tree-message">没有已索引的子目录</li>}
      {result&&result.pages>1&&<li role="none" className="tree-page"><button aria-label={`上一页目录 ${node.name}`} disabled={busy||page<=1} onClick={()=>setPage(n=>n-1)}><Icon name="chevronLeft" size={13}/></button><small>{page} / {result.pages}</small><button aria-label={`下一页目录 ${node.name}`} disabled={busy||page>=result.pages} onClick={()=>setPage(n=>n+1)}><Icon name="chevronRight" size={13}/></button></li>}
    </ul>}
  </li>;
}

export function DirectoryTree({roots,root,folder,revision,select,close,active}:{roots:Root[];root:string;folder:string;revision:number;select:(root:string,folder:string)=>void;close:()=>void;active:boolean}) {
  const [query,setQuery]=useState(''),[page,setPage]=useState(1),[expanded,setExpanded]=useState<Set<string>>(()=>new Set()),[notice,setNotice]=useState(''),[stableRevision,setStableRevision]=useState(revision);
  const [cache]=useState(()=>new Map<string,FolderPage>());
  useEffect(()=>{const timer=window.setTimeout(()=>{cache.clear();setStableRevision(revision);},300);return()=>clearTimeout(timer);},[revision,cache]);
  useEffect(()=>{
    if(!root||!folder)return;
    setExpanded(current=>{const next=new Set(current);next.add(nodeKey(Number(root),''));const parts=folder.split('/').filter(Boolean);for(let i=1;i<parts.length;i++)next.add(nodeKey(Number(root),parts.slice(0,i).join('/')));return next;});
  },[root,folder]);
  const matching=useMemo(()=>roots.filter(r=>r.path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())),[roots,query]);
  const pages=Math.max(1,Math.ceil(matching.length/50)),safePage=Math.min(page,pages);
  const shown=matching.slice((safePage-1)*50,safePage*50),selected=roots.find(r=>String(r.id)===root);
  if(selected&&!query&&!shown.some(r=>r.id===selected.id))shown.unshift(selected);
  const shared:Shared={active,selectedRoot:root,selectedFolder:folder,revision:stableRevision,cache,expanded,select,toggle:key=>{
    if(!expanded.has(key)&&expanded.size>=32){setNotice('请先收起部分目录，或点击“全部收起”。');return;}
    setNotice('');setExpanded(current=>{
      const next=new Set(current);
      if(next.has(key)){for(const value of next)if(value===key||value.startsWith(key+(key.endsWith(':')?'':'/')))next.delete(value);}
      else next.add(key);
      return next;
    });
  }};
  return <aside className="directory-tree-panel" aria-label="多级目录树">
    <div className="directory-tree-heading"><Icon name="folder" size={16}/><h2>目录</h2><button className="ui-icon-button" aria-label="全部收起目录" title="全部收起" onClick={()=>{setExpanded(new Set());setNotice('');}}><Icon name="list" size={15}/></button><button className="ui-icon-button" aria-label="收起目录树" title="收起目录树" onClick={close}><Icon name="chevronLeft" size={15}/></button></div>
    <input type="search" aria-label="搜索目录树媒体目录" placeholder="筛选媒体目录…" value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}}/>
    <button className={`tree-all${!root?' is-selected':''}`} aria-label="全部目录" aria-pressed={!root} onClick={()=>select('','')}><Icon name="library" size={15}/><span>全部目录</span><small>{roots.length}</small></button>
    <div className="directory-tree-scroll"><ul role="tree" aria-label="媒体目录树">{shown.map(r=><TreeBranch key={r.id} shared={shared} node={{root:r,folder:'',name:r.path.split(/[\\/]/).filter(Boolean).at(-1)||r.path,branch:true,level:1}}/>)}</ul>
      {!shown.length&&<p className="tree-message">{roots.length?'没有匹配的媒体目录':'添加媒体目录后在这里浏览'}</p>}
    </div>
    {pages>1&&<div className="tree-page"><button aria-label="上一页媒体目录树" disabled={safePage<=1} onClick={()=>setPage(safePage-1)}><Icon name="chevronLeft" size={14}/></button><small>{safePage} / {pages} · {matching.length} 个</small><button aria-label="下一页媒体目录树" disabled={safePage>=pages} onClick={()=>setPage(safePage+1)}><Icon name="chevronRight" size={14}/></button></div>}
    {notice&&<p className="tree-message" role="status">{notice}</p>}
  </aside>;
}
