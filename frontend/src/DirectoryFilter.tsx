import { useMemo, useState } from 'react';
import type { Root } from './api';

export function DirectoryFilter({ roots, value, change }: { roots: Root[]; value: string; change: (value: string) => void }) {
  const [query, setQuery] = useState('');
  const large = roots.length > 80;
  const matching = useMemo(() => roots.filter(root => root.path.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())), [roots, query]);
  const shown = large ? matching.slice(0, 50) : roots;
  const selected = roots.find(root => String(root.id) === value);
  const options = selected && !shown.some(root => root.id === selected.id) ? [selected, ...shown] : shown;
  return <div className="directory-filter">
    {large && <input type="search" aria-label="查找媒体目录" placeholder="输入目录名称或路径…" value={query} onChange={event => setQuery(event.target.value)} />}
    <select className="folder-filter" aria-label="按目录筛选" value={value} onChange={event => change(event.target.value)}>
      <option value="">全部目录</option>{options.map(root => <option key={root.id} value={root.id} title={root.path}>{root.path}{root.available === false ? '（离线）' : ''}</option>)}
    </select>
    {large && <small>{matching.length > 50 ? `匹配 ${matching.length} 个，显示前 50 个` : `匹配 ${matching.length} 个目录`}</small>}
  </div>;
}
