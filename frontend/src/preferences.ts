import { api, json } from './api';

const cache:Record<string,unknown>={};
let pending:Record<string,unknown>={};
let timer:number|undefined;
let timestamp=0;
const globals=['audio','playbackSpeed','subtitleAppearance','hoverPreview','queueOpen','autoNext','queueMode','screenshots'];
const writes=new Set<Promise<boolean>>();
const message='设置尚未保存到媒体库，请重试；当前会话仍可使用。';

function legacy(key:string):unknown {
  try { const value=localStorage.getItem(`avhub.${key}`); return value===null?undefined:JSON.parse(value); }
  catch {return undefined;}
}
function mirror(key:string,value:unknown) {
  try {localStorage.setItem(`avhub.${key}`,JSON.stringify(value));} catch {/* Database is authoritative. */}
}
export function preference<T>(key:string,fallback:T):T {
  return (cache[key]===undefined?fallback:cache[key]) as T;
}
// Only use after an explicit settings endpoint confirms the durable value.
export function rememberSavedPreference(key:string,value:unknown) {
  cache[key]=value;mirror(key,value);
}
export async function initializePreferences() {
  const result=await api<{values:Record<string,unknown>}>('/api/preferences');
  const migrated:Record<string,unknown>={};
  for(const key of globals) {
    const value=legacy(key);
    if(result.values[key]===undefined && value!==undefined) migrated[key]=value;
  }
  // Legacy values are untrusted. Validate individually so one corrupt value
  // cannot prevent startup or discard the other valid old preferences.
  for(const [key,value] of Object.entries(migrated)) {
    try {await api('/api/preferences',json('PATCH',{values:{[key]:value},import_only_missing:true}));}
    catch {/* Ignore malformed legacy preference; normal GET remains required. */}
  }
  const current=Object.keys(migrated).length?await api<{values:Record<string,unknown>}>('/api/preferences'):result;
  for(const key of Object.keys(cache))delete cache[key];
  Object.assign(cache,current.values);
  for(const [key,value] of Object.entries(current.values)) mirror(key,value);
}
export async function loadSubtitlePreference<T>(mediaId:number):Promise<T|null> {
  const key=`subtitle.${mediaId}`;
  if(cache[key]!==undefined)return cache[key] as T;
  const result=await api<{value:T|null}>(`/api/preferences/subtitle/${mediaId}`);
  // An older Player can finish loading after a newer one has saved a choice.
  // Never replace this session's newer cache/pending write with that stale GET.
  if(cache[key]!==undefined)return cache[key] as T;
  if(result.value!==null) {cache[key]=result.value;mirror(key,result.value);return result.value;}
  const value=legacy(key);
  if(value!==undefined) {
    try {
      await api('/api/preferences',json('PATCH',{values:{[key]:value},import_only_missing:true}));
      const saved=await api<{value:T|null}>(`/api/preferences/subtitle/${mediaId}`);
      if(cache[key]!==undefined)return cache[key] as T;
      if(saved.value!==null){cache[key]=saved.value;return saved.value;}
    } catch {/* A malformed legacy preference does not block playback. */}
  }
  return null;
}
export function savePreference(key:string,value:unknown) {
  if(JSON.stringify(cache[key])===JSON.stringify(value))return;
  cache[key]=value;mirror(key,value);pending[key]=value;
  clearTimeout(timer);timer=window.setTimeout(()=>void flushPreferences(),250);
}
export async function flushPreferences(keepalive=false) {
  clearTimeout(timer);
  const values=pending;
  if(Object.keys(values).length) {
    pending={};timestamp=Math.max(Date.now(),timestamp+1);
    const task=api('/api/preferences',{...json('PATCH',{values,updated_at:timestamp}),keepalive}).then(()=>true).catch(()=>{
      for(const [key,value] of Object.entries(values))if(cache[key]===value && !(key in pending))pending[key]=value;
      window.dispatchEvent(new CustomEvent('avhub-preferences-error',{detail:message}));return false;
    });
    writes.add(task);void task.then(()=>writes.delete(task));
  }
  const result=await Promise.all([...writes]);
  return result.every(Boolean) && !Object.keys(pending).length;
}
window.addEventListener('pagehide',()=>void flushPreferences(true));
// Electron dispatches this before closing the renderer or its local service.
window.addEventListener('avhub-before-quit',event=>{
  (event as CustomEvent<Promise<boolean>[]>).detail.push(flushPreferences());
});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')void flushPreferences(true);});
