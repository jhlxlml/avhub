import { useSyncExternalStore } from 'react';
import { preference, savePreference } from './preferences';

export type QueueMode = 'sequential'|'random'|'repeat-one';
export type QueueScope = 'series'|'directory';
type Autoplay = {enabled:boolean;mode:QueueMode;scope:QueueScope};
let state:Autoplay = {enabled:true,mode:'sequential',scope:'series'};
const listeners = new Set<()=>void>();
function publish(value:Autoplay) {state=value;listeners.forEach(listener=>listener());}
export function initializeAutoplay() {
  publish({enabled:preference('autoNext',true),mode:preference<QueueMode>('queueMode','sequential'),
    scope:preference<QueueScope>('queueScope','series')});
}
export function changeAutoplay(change:Partial<Autoplay>) {
  const next = {...state,...change};
  if(next.enabled!==state.enabled)savePreference('autoNext',next.enabled);
  if(next.mode!==state.mode)savePreference('queueMode',next.mode);
  if(next.scope!==state.scope)savePreference('queueScope',next.scope);
  publish(next);
}
function subscribe(listener:()=>void) {listeners.add(listener);return()=>{listeners.delete(listener);};}
export function useAutoplay() {return useSyncExternalStore(subscribe,()=>state);}
