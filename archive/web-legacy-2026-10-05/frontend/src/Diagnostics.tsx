import { useEffect, useRef, useState } from 'react';
import { api, CLIENT_BUILD, errorText } from './api';
import { Button, StatusMessage } from './ui';
import { Icon } from './Icon';
import './diagnostics.css';

type Report = { build:{version:string;build_id:string;api_protocol:number;built_at:string|null}; mode:string; data_dir:string; database:string;
  python:string; uptime_seconds:number; tools:Record<string,string>; playback:{tasks:number;throttled_tasks:number;cache_bytes:number;cache_target_bytes_per_task:number;pending_cleanup:number;ahead_seconds:number;back_seconds:number};
  database_timing?:{groups:Record<string,{count:number;stages:Record<string,{p95_ms:number;max_ms:number}>}>};
  runtime_evidence?:{capacity:number;events:{at:number;component:string}[];error:string} };
export function Diagnostics() {
  const [report, setReport] = useState<Report|null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController|null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function load() {
    if (busy) return;
    const next = new AbortController(); controller.current = next;
    setBusy(true); setError('');
    try { const value = await api<Report>('/api/diagnostics', { signal:next.signal }); if (!next.signal.aborted) setReport(value); }
    catch (e) { if (!next.signal.aborted) setError(errorText(e)); }
    finally { if (!next.signal.aborted) setBusy(false); }
  }
  function download() {
    if (!report) return;
    const blob = new Blob([JSON.stringify({ ...report, frontend:CLIENT_BUILD }, null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = 'avhub-diagnostics.json'; link.click(); globalThis.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <details className="settings-section runtime-diagnostics" onToggle={event => { if (event.currentTarget.open && !report && !busy) void load(); }}>
    <summary><Icon name="info"/>运行诊断</summary>
    <p className="dialog-description">仅检查本机，不联网。数据目录决定当前使用哪个媒体库；诊断文件含本地路径，分享前请检查。</p>
    <div className="diagnostic-actions"><Button icon="refresh" busy={busy} onClick={() => void load()}>刷新诊断</Button><Button icon="download" disabled={!report || busy} onClick={download}>导出诊断</Button></div>
    {error && <StatusMessage kind="error">{error}</StatusMessage>}
    {report && <dl className="diagnostic-fields">
      <dt>启动模式</dt><dd>{report.mode}</dd>
      <dt>应用版本</dt><dd>{report.build.version} · API {report.build.api_protocol}</dd>
      <dt>服务构建</dt><dd><code>{report.build.build_id}</code></dd>
      <dt>网页构建</dt><dd><code>{CLIENT_BUILD.build_id}</code></dd>
      <dt>实际数据目录</dt><dd><code>{report.data_dir}</code></dd>
      <dt>媒体库数据库</dt><dd><code>{report.database}</code></dd>
      <dt>运行时间</dt><dd>{Math.floor(report.uptime_seconds / 60)} 分钟 · Python {report.python}</dd>
      <dt>FFmpeg</dt><dd>{report.tools.ffmpeg}</dd><dt>FFprobe</dt><dd>{report.tools.ffprobe}</dd>
      <dt>播放任务</dt><dd>{report.playback.tasks} 个 · 已节流 {report.playback.throttled_tasks} 个</dd>
      <dt>临时缓存</dt><dd>{(report.playback.cache_bytes / 1048576).toFixed(1)} MB · 每任务目标 {(report.playback.cache_target_bytes_per_task / 1073741824).toFixed(1)} GB</dd>
      <dt>缓存窗口</dt><dd>前向约 {report.playback.ahead_seconds} 秒 · 后向最多 {report.playback.back_seconds} 秒（容量紧张时收缩）</dd>
      <dt>等待回收</dt><dd>{report.playback.pending_cleanup} 个任务目录</dd>
      {report.runtime_evidence&&<><dt>异常现场</dt><dd>{report.runtime_evidence.events.length} 条（最多 {report.runtime_evidence.capacity} 条） · 导出诊断查看线程位置{report.runtime_evidence.error&&<span> · {report.runtime_evidence.error}</span>}</dd></>}
      {report.database_timing&&Object.entries(report.database_timing.groups).map(([kind,group])=><div className="diagnostic-db-timing" key={kind}><dt>{kind==='read'?'只读查询':'串行事务'} · {group.count} 次采样</dt><dd>锁等待 p95 {group.stages.lock_wait.p95_ms.toFixed(2)} ms · 事务 p95 {group.stages.transaction.p95_ms.toFixed(2)} ms · 总耗时最大 {group.stages.total.max_ms.toFixed(2)} ms</dd></div>)}
    </dl>}
  </details>;
}
