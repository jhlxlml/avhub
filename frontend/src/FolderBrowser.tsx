import { useEffect, useState } from 'react';
import { api, errorText, type FolderPage, type Root } from './api';
import { Icon } from './Icon';
import { Button, StatusMessage } from './ui';

export function FolderBrowser({ root, folder, recursive, change, changeRecursive, revision, treeMode=false }: {
  root: Root; folder: string; recursive: boolean; change: (folder: string) => void;
  changeRecursive: (recursive: boolean) => void; revision: number; treeMode?:boolean;
}) {
  const [open, setOpen] = useState(Boolean(folder)&&!treeMode);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<FolderPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => { setPage(1); setQuery(''); setResult(null); }, [root.id, folder]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ folder, q: query, page: String(page), page_size: '60' });
      void api<FolderPage>(`/api/roots/${root.id}/folders?${params}`, { signal: controller.signal }).then(value => {
        if (!controller.signal.aborted) { setResult(value); if (page !== value.page) setPage(value.page); }
      }).catch(e => { if (!controller.signal.aborted) setError(errorText(e)); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, query ? 180 : 0);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [root.id, folder, page, query, open, revision, retry]);
  const parts = folder.split('/').filter(Boolean);
  const rootName = root.path.split(/[\\/]/).filter(Boolean).at(-1) || root.path;
  return <section className="folder-browser" aria-label="子目录导航">
    <div className="folder-heading">
      <button aria-label="浏览子目录" aria-expanded={open} onClick={() => setOpen(value => !value)}><Icon name={open?'chevronDown':'chevronRight'} size={14}/>子目录</button>
      <nav aria-label="目录路径" className="folder-breadcrumbs">
        <button aria-label="返回目录根层" title={root.path} aria-current={!folder ? 'location' : undefined} onClick={() => change('')}>{rootName}</button>
        {parts.map((part, index) => <span key={index}> / <button title={parts.slice(0,index+1).join('/')}
          aria-current={index === parts.length-1 ? 'location' : undefined} onClick={() => change(parts.slice(0,index+1).join('/'))}>{part}</button></span>)}
      </nav>
      <label className="folder-recursive"><input type="checkbox" checked={recursive} onChange={event => changeRecursive(event.target.checked)} />包含子目录</label>
    </div>
    {open && <div className="folder-content">
      <div className="folder-search-row"><input type="search" aria-label="搜索子目录" placeholder="搜索本层子目录…" value={query}
        onChange={event => { setQuery(event.target.value); setPage(1); }} />
        <small>{loading ? '正在加载…' : result ? `本层 ${result.direct_count} 个视频 · 含子目录 ${result.video_count} 个` : ''}</small>
      </div>
      {error ? <div className="folder-error"><StatusMessage kind="error">{error}</StatusMessage><Button icon="refresh" onClick={() => setRetry(value => value+1)}>重试目录加载</Button></div> :
        !loading && result && (result.items.length ? <div className="folder-tiles">{result.items.map(item =>
          <button key={item.folder} aria-label={`打开子目录 ${item.name}`} title={item.folder} onClick={() => change(item.folder)}>
            <Icon name="folder" size={18}/><b>{item.name}</b><small>{item.count} 个视频</small></button>)}</div> :
          <p className="folder-empty">{query ? '没有匹配的子目录' : '本层没有已索引的视频子目录'}</p>)}
      {result && result.pages > 1 && <div className="folder-pager"><span>子目录 {result.page} / {result.pages} 页 · {result.total} 个</span>
        <button aria-label="上一页子目录" disabled={loading || page <= 1} onClick={() => setPage(value => value-1)}>上一页</button>
        <button aria-label="下一页子目录" disabled={loading || page >= result.pages} onClick={() => setPage(value => value+1)}>下一页</button></div>}
    </div>}
  </section>;
}
