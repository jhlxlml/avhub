import { useSyncExternalStore } from 'react';
import { preference, savePreference } from './preferences';

export const coverSizes = [
  {id:'compact',label:'紧凑',width:160},
  {id:'standard',label:'标准',width:190},
  {id:'comfortable',label:'舒适',width:240},
  {id:'large',label:'宽大',width:300},
] as const;
export type CoverSize = typeof coverSizes[number]['id'];
export type Appearance = {theme:'dark'|'light';coverSize:CoverSize};
const defaults:Appearance = {theme:'dark',coverSize:'standard'};
function validated(value:unknown):Appearance {
  if (!value || typeof value !== 'object') return defaults;
  const candidate=value as Partial<Appearance>;
  return {theme:candidate.theme==='light'?'light':'dark',
    coverSize:coverSizes.some(size=>size.id===candidate.coverSize)?candidate.coverSize!:defaults.coverSize};
}
function cachedAppearance():Appearance {
  try {return validated(JSON.parse(localStorage.getItem('avhub.appearance')||'null'));}
  catch {return defaults;}
}
let state=cachedAppearance();
const listeners=new Set<()=>void>();
function apply() {
  // Changing CSS tokens never rebuilds media cards, refetches the index, or
  // replaces the video element. Keep display preferences outside query state.
  document.documentElement.dataset.theme=state.theme;
  document.documentElement.dataset.coverSize=state.coverSize;
}
function publish(value:Appearance) {
  state=value;apply();listeners.forEach(listener=>listener());
}
apply();
export function initializeAppearance() {publish(validated(preference('appearance',defaults)));}
export function changeAppearance(change:Partial<Appearance>) {
  const next=validated({...state,...change});
  if(next.theme===state.theme&&next.coverSize===state.coverSize)return;
  publish(next);savePreference('appearance',next);
}
function subscribe(listener:()=>void) {listeners.add(listener);return()=>{listeners.delete(listener);};}
export function useAppearance() {return useSyncExternalStore(subscribe,()=>state);}
