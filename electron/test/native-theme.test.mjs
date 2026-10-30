import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {NativeThemeSync} from '../../frontend/src/nativeThemeSync.ts';
const require=createRequire(import.meta.url);
const {nativeAppearance,nativeThemeColors,nativeColorsJson}=require('../dist/nativeTheme.js');
const {IndependentPlayer}=require('../dist/independentPlayer.js');
const value={palette:'custom',accent:'#aabbcc',background:'warm',emphasis:'soft'};
const tick=()=>new Promise(r=>setTimeout(r,10));
test('native colors validate fixed fields and share accessible dark surfaces',()=>{
 assert.deepEqual(nativeAppearance(value),value);
 for(const bad of [{...value,extra:'x'},{...value,accent:'url(x)'},{...value,palette:'missing'},null])assert.throws(()=>nativeAppearance(bad));
 assert.equal(JSON.parse(nativeColorsJson(nativeThemeColors(value))).accent,nativeThemeColors(value).accent);
 assert.throws(()=>nativeColorsJson({...nativeThemeColors(value),text:'white'}));
});
test('renderer coalesces changes, deduplicates state ticks, restores cancelled preview and ignores closed session',async()=>{
 const calls=[];let release;
 const sync=new NativeThemeSync(async(s,v)=>{calls.push([s,v]);if(calls.length===1)await new Promise(r=>release=r);});
 sync.update(value);sync.setSession('a');await tick();
 for(let i=0;i<30;i++){sync.setSession('a');sync.update({...value,accent:'#112233'});}
 sync.update(value);release();await tick();assert.equal(calls.length,1);
 sync.update({...value,accent:'#112233'});await tick();assert.equal(calls.length,2);
 sync.update(value);await tick();assert.equal(calls.length,3);
 sync.clearSession('a');sync.update({...value,accent:'#334455'});await tick();assert.equal(calls.length,3);
 sync.setSession('b');sync.clearSession('a');await tick();assert.equal(calls.at(-1)[0],'b');
});
test('native coordinator serializes latest color without any seek or load command',async()=>{
 const p=new IndependentPlayer({api:async()=>{},send:()=>{},log:()=>{}}),calls=[];let release;
 const session='a'.repeat(32),s={client:{session,command:async c=>{calls.push(c);if(calls.length===1)await new Promise(r=>release=r);}},ready:true,closing:false,stopped:false};p.active=s;
 const first=p.updateAppearance({session,appearance:value});
 const last=p.updateAppearance({session,appearance:{...value,accent:'#223344'}});
 release();await Promise.all([first,last]);assert.equal(calls.length,2);
 assert.ok(calls.every(c=>c[0]==='script-message-to'&&c[1]==='avhub_ui'&&c[2]==='theme'));
 assert.deepEqual(JSON.parse(calls.at(-1)[3]),nativeThemeColors({...value,accent:'#223344'}));
 assert.deepEqual(await p.updateAppearance({session:'b'.repeat(32),appearance:value}),{applied:false});
 s.closing=true;assert.deepEqual(await p.updateAppearance({session,appearance:value}),{applied:false});
});
