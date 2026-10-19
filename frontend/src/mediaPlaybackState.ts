import {api,json,errorText} from './api';
export type MediaPlaybackState={source:string;audio:number|null;subtitle:string|null;delay:number};
const pending=new Map<number,Promise<boolean>>();
const invalidated=new WeakSet<MediaPlaybackState>();
const failed=new Map<number,{state:MediaPlaybackState;changes:Partial<Pick<MediaPlaybackState,'audio'|'subtitle'|'delay'>>}>();
let timestamp=0;
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
export async function flushMediaPlaybackState(){await Promise.all([...pending.values()]);for(const [id,value] of [...failed])await saveMediaPlaybackState(id,value.state,value.changes);return !failed.size;}
window.addEventListener('avhub-before-quit',event=>(event as CustomEvent<Promise<boolean>[]>).detail.push(flushMediaPlaybackState()));
