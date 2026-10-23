import {useSyncExternalStore} from 'react';
import {preference,savePreference} from './preferences';

function cached(){try{return JSON.parse(localStorage.getItem('avhub.privacyMode')||'false')===true;}catch{return false;}}
let enabled=cached();
const listeners=new Set<()=>void>();
function apply(){document.documentElement.dataset.privacy=enabled?'on':'off';}
apply();
function publish(value:boolean){enabled=value;apply();listeners.forEach(listener=>listener());}
export function initializePrivacy(){publish(preference<boolean>('privacyMode',false)===true);}
export function changePrivacy(value:boolean){if(value===enabled)return;publish(value);savePreference('privacyMode',value);}
export function usePrivacy(){return useSyncExternalStore(listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};},()=>enabled);}
