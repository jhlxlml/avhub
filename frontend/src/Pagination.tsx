import { useEffect, useState } from 'react';
import { Icon } from './Icon';

export function Pagination({ page, pages, total, pageSize, busy, changePage, changeSize }: {
  page: number; pages: number; total: number; pageSize: number; busy: boolean;
  changePage: (page: number) => void; changeSize: (size: number) => void;
}) {
  const [target, setTarget] = useState(String(page));
  useEffect(() => setTarget(String(page)), [page]);
  return <div className="pagination" aria-label="媒体库分页">
    <span>共 {total} 个视频 · 第 {page} / {pages} 页</span>
    <div className="page-buttons">
      <button disabled={busy || page <= 1} onClick={() => changePage(1)}><Icon name="first" size={14}/>首页</button>
      <button disabled={busy || page <= 1} onClick={() => changePage(page - 1)}><Icon name="chevronLeft" size={14}/>上一页</button>
      <button disabled={busy || page >= pages} onClick={() => changePage(page + 1)}>下一页<Icon name="chevronRight" size={14}/></button>
      <button disabled={busy || page >= pages} onClick={() => changePage(pages)}>末页<Icon name="last" size={14}/></button>
    </div>
    <form onSubmit={e => { e.preventDefault(); if (/^\d+$/.test(target)) changePage(Math.min(pages, Math.max(1, Number(target)))); }}>
      <input aria-label="跳转页码" type="number" min={1} max={pages} value={target} onChange={e => setTarget(e.target.value)} />
      <button disabled={busy}>跳转</button>
    </form>
    <select aria-label="每页数量" value={pageSize} disabled={busy} onChange={e => changeSize(Number(e.target.value))}>
      {[24,48,96].map(size => <option key={size} value={size}>每页 {size} 个</option>)}
    </select>
  </div>;
}
