import { useSyncExternalStore } from 'react';
import { preference, savePreference,flushPreferences,rememberSavedPreference } from './preferences';
import {api,json} from './api';
import {defaultTheme,normalizeTheme,themeColors,type ThemeSettings} from './themePalette';
import {NativeThemeSync} from './nativeThemeSync';

export const coverSizes = [
  {id:'compact',label:'紧凑',width:160},
  {id:'standard',label:'标准',width:190},
  {id:'comfortable',label:'舒适',width:240},
  {id:'large',label:'宽大',width:300},
] as const;
export type CoverSize = typeof coverSizes[number]['id'];
export type Appearance = ThemeSettings&{coverSize:CoverSize};
export const defaultAppearance:Appearance = {...defaultTheme,coverSize:'standard'};
const defaults=defaultAppearance;
function validated(value:unknown):Appearance {
  if (!value || typeof value !== 'object') return defaults;
  const candidate=value as Partial<Appearance>;
  return {...normalizeTheme(candidate),
    coverSize:coverSizes.some(size=>size.id===candidate.coverSize)?candidate.coverSize!:defaults.coverSize};
}
function cachedAppearance():Appearance {
  try {return validated(JSON.parse(localStorage.getItem('avhub.appearance')||'null'));}
  catch {return defaults;}
}
let state=cachedAppearance();
let committed=state;
let preview:{owner:symbol;value:Appearance}|null=null;
const systemTheme=window.matchMedia('(prefers-color-scheme: dark)');
const listeners=new Set<()=>void>();
const desktop=window.avhubDesktop;
const nativeSync=desktop?.nativePlayer&&!new URLSearchParams(location.search).has('nativePlayer')?
 new NativeThemeSync((session,appearance)=>desktop.nativePlayer('appearance',{session,appearance}),()=>window.dispatchEvent(new CustomEvent('avhub-preferences-error',{detail:'原生窗口配色未同步，可重新选择配色重试'}))):null;
if(nativeSync){
 desktop!.onNativeState(value=>{
  if(typeof value.session!=='string'||!/^[a-f0-9]{32}$/.test(value.session))return;
  if(value.presentation==='independent'&&!value.stopped&&['starting','ready','ended'].includes(value.phase))nativeSync.setSession(value.session);
  else nativeSync.clearSession(value.session);
 });
 desktop!.onNativeClosed(value=>{if(typeof value.session==='string')nativeSync.clearSession(value.session);});
}
export const resolvedTheme=()=>state.theme==='system'?(systemTheme.matches?'dark':'light'):state.theme;
function apply() {
  // Changing CSS tokens never rebuilds media cards, refetches the index, or
  // replaces the video element. Keep display preferences outside query state.
  const mode=resolvedTheme();
  document.documentElement.dataset.theme=mode;
  document.documentElement.dataset.themeMode=state.theme;
  document.documentElement.classList.toggle('dark',mode==='dark');
  document.documentElement.dataset.coverSize=state.coverSize;
  for(const [name,value] of Object.entries(themeColors(state,mode)))document.documentElement.style.setProperty(name,value);
  nativeSync?.update(state);
}
function publish(value:Appearance) {
  state=value;apply();listeners.forEach(listener=>listener());
}
apply();
systemTheme.addEventListener('change',()=>{if(state.theme==='system'){apply();listeners.forEach(listener=>listener());}});
export function initializeAppearance() {committed=validated(preference('appearance',defaults));if(!preview)publish(committed);}
export function changeAppearance(change:Partial<Appearance>) {
  const next=validated({...committed,...change});
  if(JSON.stringify(next)===JSON.stringify(committed))return;
  committed=next;publish(preview?{...preview.value,coverSize:next.coverSize}:next);savePreference('appearance',next);
}
export const savedAppearance=()=>committed;
export function previewAppearance(owner:symbol,value:Appearance){preview={owner,value:validated({...value,coverSize:committed.coverSize})};publish(preview.value);}
export function cancelAppearancePreview(owner:symbol){if(preview?.owner===owner){preview=null;publish(committed);}}
export async function saveAppearance(value:Appearance,owner:symbol){
 if(!await flushPreferences())throw new Error('已有设置尚未保存，请重试');
 const next=validated({...value,coverSize:committed.coverSize});
 const confirmed=await api<{appearance:unknown}>('/api/preferences',json('PATCH',{values:{appearance:next}}));
 const receipt=confirmed.appearance as Record<string,unknown>|null;
 if(!receipt||typeof receipt!=='object'||Object.keys(receipt).length!==Object.keys(next).length||Object.entries(next).some(([key,value])=>receipt[key]!==value))throw new Error('外观设置尚未确认保存，请重试');
 committed=next;rememberSavedPreference('appearance',next);
 if(preview?.owner===owner)preview=null;
 publish(preview?{...preview.value,coverSize:next.coverSize}:next);return next;
}
function subscribe(listener:()=>void) {listeners.add(listener);return()=>{listeners.delete(listener);};}
export function useAppearance() {return useSyncExternalStore(subscribe,()=>state);}
export function useResolvedTheme(){return useSyncExternalStore(subscribe,resolvedTheme);}
