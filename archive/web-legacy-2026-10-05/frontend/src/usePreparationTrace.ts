import { useCallback, useRef, useState } from 'react';

export const preparationLabels = {
  queue: '上一播放任务收尾', api: '本地播放接口', stream: '首批播放分片',
  attach: '播放器模块初始化', browser: '浏览器载入视频',
} as const;
type Stage = keyof typeof preparationLabels;
export type BackendPreparation = { metadata_ms?: number; source_check_ms?: number; color_probe_ms?: number; task_ms?: number; total_ms?: number };
type Trace = { current: Stage | null; stages: Partial<Record<Stage, number>>; backend?: BackendPreparation; totalMs?: number; failed?: boolean };

export function usePreparationTrace() {
  const sequence = useRef(0);
  const [trace, setTrace] = useState<Trace>({ current: null, stages: {} });
  const begin = useCallback(() => {
    const id = ++sequence.current;
    const started = performance.now();
    let tick = started;
    let state: Trace = { current: 'queue', stages: {} };
    const publish = () => { if (sequence.current === id) setTrace({ ...state, stages: { ...state.stages } }); };
    const endStage = () => {
      const now = performance.now();
      if (state.current) state.stages[state.current] = Math.round(now - tick);
      tick = now;
    };
    publish();
    return {
      advance(stage: Stage) { endStage(); state.current = stage; publish(); },
      backend(value?: BackendPreparation) { state.backend = value; publish(); },
      finish(failed = false) { if (state.totalMs !== undefined) return; endStage(); state.current = null; state.totalMs = Math.round(tick - started); state.failed = failed; publish(); },
      discard() { if (sequence.current === id) sequence.current++; },
    };
  }, []);
  return { trace, begin };
}
