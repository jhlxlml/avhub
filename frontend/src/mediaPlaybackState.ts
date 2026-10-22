import {api,json,errorText} from './api';
export type MediaPlaybackState={source:string;audio:number|null;subtitle:string|null;delay:number};
const pending=new Map<number,Promise<boolean>>();
const invalidated=new WeakSet<MediaPlaybackState>();
const failed=new Map<number,{state:MediaPlaybackState;changes:Partial<Pick<MediaPlaybackState,'audio'|'subtitle'|'delay'>>}>();
let timestamp=0;
let confirmation:{task:Promise<boolean>;done:boolean}|null=null;
export function readMediaPlaybackState(id:number){return api<MediaPlaybackState>(`/api/media/${id}/playback-state`);}
export function saveMediaPlaybackState(id:number,state:MediaPlaybackState,changes:Partial<Pick<MediaPlaybackState,'audio'|'subtitle'|'delay'>>){
  if(invalidated.has(state))return Promise.resolve(true);
  timestamp=Math.max(Date.now(),timestamp+1);const updated_at=timestamp;
  const task=(pending.get(id)??Promise.resolve(true)).then(async()=>{
    if(invalidated.has(state))return true;
    const old=failed.get(id),merged={...(old?.state.source===state.source?old.changes:{}),...changes};
    try{await api(`/api/media/${id}/playback-state`,json('PATCH',{source:state.source,changes:merged,updated_at}));Object.assign(state,merged);failed.delete(id);return true;}
    catch(error){
      if(error instanceof Error&&'status' in error&&error.status===409){
        // The server refuses a changed/reviewed source. Retire only this
        // obsolete state object, never bind old-session choices to a new file.
        invalidated.add(state);failed.delete(id);
        window.dispatchEvent(new CustomEvent('avhub-preferences-error',{detail:'源视频已变化，本次播放记忆未套用到新文件；重新打开视频后可继续保存'}));return true;
      }
      failed.set(id,{state,changes:merged});window.dispatchEvent(new CustomEvent('avhub-preferences-error',{detail:`播放记忆未保存：${errorText(error)}`}));return false;
    }
  });pending.set(id,task);void task.then(()=>{if(pending.get(id)===task)pending.delete(id);});return task;
}
export function flushMediaPlaybackState(){
  if(confirmation&&!confirmation.done)return confirmation.task;
  let entry!:{task:Promise<boolean>;done:boolean};
  const task=(async()=>{
    // Publish the shared barrier before inspecting even an empty queue.
    await Promise.resolve();
    const retried=new Set<number>();
    try{
      for(;;){
        const writing=[...pending.values()];
        if(writing.length){await Promise.all(writing);continue;}
        const retry=[...failed].find(([id])=>!retried.has(id));
        if(!retry)return !failed.size;
        const [id,value]=retry;retried.add(id);
        // One automatic retry per media in this confirmation round. A failed
        // retry must not loop; later explicit confirmations can try again.
        await saveMediaPlaybackState(id,value.state,value.changes);
        // Re-read the queue: edits made during any wait remain protected.
      }
    }finally{entry.done=true;}
  })();
  entry={task,done:false};confirmation=entry;
  const clear=()=>{if(confirmation===entry)confirmation=null;};
  void task.then(clear,clear);
  return task;
}
window.addEventListener('avhub-before-quit',event=>(event as CustomEvent<Promise<boolean>[]>).detail.push(flushMediaPlaybackState()));
