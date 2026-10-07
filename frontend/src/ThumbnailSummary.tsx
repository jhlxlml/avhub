import {type ThumbnailStatus} from './ThumbnailTasks';

export function thumbnailState(status:ThumbnailStatus|null){
  if(!status)return {label:'正在读取任务状态',tone:'neutral'};
  if(status.error)return {label:'任务异常',tone:'attention'};
  if(status.paused)return {label:'已暂停',tone:'neutral'};
  if(status.yielding)return {label:'等待播放空闲',tone:'neutral'};
  if(status.current)return {label:'正在生成',tone:'neutral'};
  if(status.pending)return {label:status.blocked===status.pending?'等待目录连接':'排队中',tone:'neutral'};
  if(status.failed)return {label:'有失败任务待检查',tone:'attention'};
  return {label:status.published?'已完成':'暂无任务',tone:status.published?'success':'neutral'};
}
export function ThumbnailSummary({status}:{status:ThumbnailStatus|null}){
  const state=thumbnailState(status);
  return <div className="thumbnail-task-summary"><span>待处理 {status?.pending??'…'}</span><span>失败 {status?.failed??'…'}</span><span className="task-summary-state" data-tone={state.tone} role="status">{state.label}</span></div>;
}
