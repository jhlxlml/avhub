import { useLayoutEffect, useState } from 'react';
import {IconButton} from './ui';

export function Pagination({ page, pages, total, pageSize, busy, changePage, changeSize,itemLabel='个视频' }: {
  page: number; pages: number; total: number; pageSize: number; busy: boolean;
  changePage: (page: number) => void; changeSize: (size: number) => void;
  itemLabel?:string;
}) {
  const [target, setTarget] = useState(String(page));
  // Sync before paint: a late passive effect must not overwrite a draft the
  // user has already started editing immediately after a page transition.
  useLayoutEffect(() => setTarget(String(page)), [page]);
  return <div className="pagination-footer"><div className="pagination" role="navigation" aria-label="媒体库分页" aria-busy={busy||undefined}>
    <span className="pagination-summary">共 {total.toLocaleString('zh-CN')} {itemLabel}</span>
    <div className="page-buttons">
      <IconButton icon="first" label="首页" disabled={busy || page <= 1} onClick={() => changePage(1)}/>
      <IconButton icon="chevronLeft" label="上一页" disabled={busy || page <= 1} onClick={() => changePage(page - 1)}/>
      <span className="pagination-position" aria-live="polite" aria-atomic="true">第 {page} / {pages} 页</span>
      <IconButton icon="chevronRight" label="下一页" disabled={busy || page >= pages} onClick={() => changePage(page + 1)}/>
      <IconButton icon="last" label="末页" disabled={busy || page >= pages} onClick={() => changePage(pages)}/>
    </div>
    <div className="pagination-tools">
    <form aria-label="跳转页面" onSubmit={e => { e.preventDefault(); if (!busy&&/^\d+$/.test(target)) changePage(Math.min(pages, Math.max(1, Number(target)))); }}>
      <input aria-label="跳转页码" type="number" min={1} max={pages} disabled={busy} value={target} onChange={e => setTarget(e.target.value)} />
      <IconButton icon="arrowRight" className="pagination-jump" label="跳转" type="submit" disabled={busy||!/^\d+$/.test(target)}/>
    </form>
    <select aria-label="每页数量" value={pageSize} disabled={busy} onChange={e => changeSize(Number(e.target.value))}>
      {[24,48,96].map(size => <option key={size} value={size}>每页 {size} 个</option>)}
    </select>
    </div>
  </div></div>;
}
