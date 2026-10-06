import {useSyncExternalStore} from 'react';
import {api,json} from './api';
import {preference,rememberSavedPreference} from './preferences';

let enabled=false;
const listeners=new Set<()=>void>();
export function initializeNativePreparation() {
  enabled=preference<boolean>('nativePrepare',false)===true;
  listeners.forEach(listener=>listener());
}
export async function changeNativePreparation(value:boolean) {
  await api('/api/preferences',json('PATCH',{values:{nativePrepare:value}}));
  const current=await api<{values:Record<string,unknown>}>('/api/preferences');
  const saved=current.values.nativePrepare===true;
  rememberSavedPreference('nativePrepare',saved);initializeNativePreparation();
  if(saved!==value)throw new Error('设置未更新，请重试。');
}
function subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};}
export function useNativePreparation(){return useSyncExternalStore(subscribe,()=>enabled);}
