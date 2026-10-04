import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText } from './api';
import { Icon } from './Icon';
import './scan-progress.css';

export type ScanJob = {
  id: string; root_id: number | null; state: 'discovering' | 'running' | 'cancelling' | 'interrupted' | 'completed' | 'cancelled' | 'failed';
  total: number; processed: number; updated: number; current: string; error_count: number;
  errors: { path: string; message: string }[]; started_at: number; finished_at: number | null;
  discovery_done?: boolean; thumbnails_pending?: number;
};
const active = (job: ScanJob | null) => Boolean(job && ['discovering','running','cancelling'].includes(job.state));

export function useScan(onComplete: () => void, report: (message: string) => void, onProgress?: () => void) {
  const [job, setJob] = useState<ScanJob | null>(null);
  const [starting, setStarting] = useState(false);
  const busy = useRef(false);
  const sequence = useRef(0);
  const completed = useRef('');
  const progressRefresh = useRef({ id: '', updated: 0, at: 0 });
  const [connectionError, setConnectionError] = useState('');
  useEffect(() => {
    let stopped = false;
    let timer: number;
    async function poll() {
      if (!busy.current) {
        const seq = ++sequence.current;
        try {
          const result = await api<ScanJob | null>('/api/scan');
          if (!stopped && seq === sequence.current) { setJob(result); setConnectionError(''); }
        } catch { if (!stopped) setConnectionError('扫描状态暂时无法更新，正在重试…'); }
      }
      if (!stopped) timer = window.setTimeout(poll, 1000);
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);
  useEffect(() => {
    if (job?.finished_at && completed.current !== job.id) { completed.current = job.id; onComplete(); }
  }, [job, onComplete]);
  useEffect(() => {
    if (!job || !active(job) || !onProgress) return;
    const previous = progressRefresh.current;
    if (job.updated && (previous.id !== job.id || job.updated !== previous.updated) && Date.now() - previous.at >= 3000) {
      progressRefresh.current = { id: job.id, updated: job.updated, at: Date.now() };
      onProgress();
    }
  }, [job, onProgress]);
  const start = useCallback(async (root?: number) => {
    if (busy.current) return;
    busy.current = true; ++sequence.current; setStarting(true);
    try { setJob(await api<ScanJob>('/api/scan' + (root ? `?root_id=${root}` : ''), { method: 'POST' })); }
    catch (e) { report(errorText(e)); }
    finally { busy.current = false; setStarting(false); }
  }, [report]);
  const resume = useCallback(async () => {
    if (busy.current) return;
    busy.current = true; ++sequence.current; setStarting(true);
    try { setJob(await api<ScanJob>('/api/scan/resume', { method: 'POST' })); }
    catch (e) { report(errorText(e)); }
    finally { busy.current = false; setStarting(false); }
  }, [report]);
  async function cancel() {
    busy.current = true; ++sequence.current;
    try { setJob(await api<ScanJob>('/api/scan/cancel', { method: 'POST' })); }
    catch (e) { report(errorText(e)); }
    finally { busy.current = false; }
  }
  return { job, start, resume, cancel, scanning: starting || active(job), connectionError };
}

export function ScanProgress({ job, cancel, connectionError }: { job: ScanJob | null; cancel: () => Promise<void>; connectionError: string }) {
  const [dismissed, setDismissed] = useState('');
  if (!job || job.state === 'interrupted' || dismissed === job.id) return null;
  const labels = { discovering:'正在查找视频', running:'正在扫描', cancelling:'正在取消（等待当前文件处理结束）', interrupted:'上次扫描未完成', completed:'扫描完成', cancelled:'扫描已取消', failed:'扫描失败' };
  return <section className="scan-status" aria-label="扫描任务">
    <div className="scan-heading"><strong><Icon name={active(job)?'refresh':job.state==='completed'?'check':'warning'} size={16} className={active(job)?'is-spinning':''}/>{job.state === 'running' && job.discovery_done && job.thumbnails_pending ? '正在生成封面' : labels[job.state]}</strong><span>{job.state === 'running' && job.discovery_done === false ? `已发现 ${job.total} 个 · 已索引 ${job.processed} 个` : `${job.processed} / ${job.total} 个视频 · 更新 ${job.updated} 个`}</span>
      {active(job) ? <button disabled={job.state === 'cancelling'} onClick={() => void cancel()}>取消扫描</button> :
        <button className="ui-icon-button" aria-label="收起扫描结果" onClick={() => setDismissed(job.id)}><Icon name="close" size={16}/></button>}</div>
    {active(job) && <progress aria-label="扫描进度" max={Math.max(1, job.total)} value={job.state === 'discovering' || job.discovery_done === false ? undefined : job.processed} />}
    {job.current && <div className="scan-current" title={job.current}>{job.current}</div>}
    {connectionError && <p role="status">{connectionError}</p>}
    {job.error_count > 0 && <details><summary>{job.error_count} 项需要检查{job.error_count > 20 ? '（展示前 20 项）' : ''}</summary>
      <ul>{job.errors.map((error, index) => <li key={index}><span>{error.path}</span>：{error.message}</li>)}</ul></details>}
  </section>;
}

export function ScanRecovery({ job, resume }: { job: ScanJob | null; resume: () => Promise<void> }) {
  if (job?.state !== 'interrupted') return null;
  return <button className="scan-recovery" aria-label="继续上次扫描" title="上次扫描未完成 · 点击继续增量扫描" onClick={() => void resume()}>
    <Icon name="refresh"/><i aria-hidden="true" />
  </button>;
}
