// Executes the actual TypeScript module with a controlled API, not a timing
// benchmark. Real controls/backend persistence are accepted in Electron too.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const source=readFileSync(new URL('../../frontend/src/mediaPlaybackState.ts',import.meta.url),'utf8');
const compiled=stripTypeScriptTypes(source.replace("import {api,json,errorText} from './api';",'const {api,json,errorText}=globalThis.__apiStub;'),{mode:'strip'})
 .replace(/\bexport (?=(?:async )?function )/g,'')+'\nglobalThis.__memory={readMediaPlaybackState,saveMediaPlaybackState,flushMediaPlaybackState};';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t){
 const calls=[],listeners=new Map(),notices=[];let closing=false;
 const stub={json:(method,body)=>({method,body:JSON.stringify(body)}),errorText:error=>error.message,
  api:(url,options)=>new Promise((resolve,reject)=>{const row={url,body:JSON.parse(options.body),resolve,reject};calls.push(row);if(closing)resolve({});})};
 const context=createContext({__apiStub:stub,Error,
  window:{addEventListener:(name,fn)=>listeners.set(name,fn),dispatchEvent:event=>{notices.push(event.detail);return true;}},
  CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}}});
 runInContext(compiled,context);
 t.after(()=>{closing=true;for(const row of calls)row.resolve({});});
 return {...context.__memory,calls,listeners,notices,state:()=>({source:'a'.repeat(64),audio:null,subtitle:null,delay:0})};
}
const fail=row=>row.reject(Object.assign(new Error('owned write failure'),{status:503}));

test('overlapping pause/back/quit barriers share one retry, explicit retry remains possible',async t=>{
 const f=fixture(t),state=f.state();const writing=f.saveMediaPlaybackState(1,state,{subtitle:'embedded:2'});
 const first=f.flushMediaPlaybackState(),second=f.flushMediaPlaybackState(),quit=[];
 f.listeners.get('avhub-before-quit')({detail:quit});
 assert.equal(first,second);assert.equal(first,quit[0]);
 await tick();assert.equal(f.calls.length,1);fail(f.calls[0]);await tick();
 assert.equal(f.calls.length,2);assert.equal(f.flushMediaPlaybackState(),first);fail(f.calls[1]);
 assert.equal(await writing,false);assert.equal(await first,false);assert.equal(await second,false);
 await tick();assert.equal(f.calls.length,2,'A failed retry must not loop or multiply per caller');
 const retry=f.flushMediaPlaybackState();await tick();assert.equal(f.calls.length,3);f.calls[2].resolve({});
 assert.equal(await retry,true);assert.equal(state.subtitle,'embedded:2');
});

test('barrier includes new writes queued while its original snapshot is pending',async t=>{
 const f=fixture(t),state=f.state();f.saveMediaPlaybackState(1,state,{subtitle:'embedded:2'});
 const barrier=f.flushMediaPlaybackState();let settled=false;void barrier.then(()=>settled=true);
 await tick();f.saveMediaPlaybackState(1,state,{delay:.6});f.calls[0].resolve({});await tick();
 assert.equal(f.calls.length,2);assert.equal(settled,false,'New queued edits must not escape the confirmation barrier');
 f.calls[1].resolve({});assert.equal(await barrier,true);assert.equal(state.delay,.6);
});

test('new edits during a failing retry survive and are drained without another automatic retry loop',async t=>{
 const f=fixture(t),state=f.state();f.saveMediaPlaybackState(1,state,{subtitle:'embedded:2'});
 const barrier=f.flushMediaPlaybackState();await tick();fail(f.calls[0]);await tick();
 f.saveMediaPlaybackState(1,state,{delay:.7});fail(f.calls[1]);await tick();
 assert.equal(f.calls.length,3);assert.equal(f.calls[2].body.changes.subtitle,'embedded:2');assert.equal(f.calls[2].body.changes.delay,.7);
 assert.ok(f.calls[2].body.updated_at>f.calls[1].body.updated_at);
 f.calls[2].resolve({});assert.equal(await barrier,true);assert.equal(state.delay,.7);assert.equal(state.subtitle,'embedded:2');
});

test('completed confirmations are not cached for later writes',async t=>{
 const f=fixture(t),state=f.state(),empty=f.flushMediaPlaybackState();assert.equal(await empty,true);
 f.saveMediaPlaybackState(1,state,{audio:1});const next=f.flushMediaPlaybackState();assert.notEqual(next,empty);
 let settled=false;void next.then(()=>settled=true);await tick();assert.equal(settled,false);
 f.calls[0].resolve({});assert.equal(await next,true);
});

test('source conflict retires old state and cannot apply its changes to a new source',async t=>{
 const f=fixture(t),old=f.state();f.saveMediaPlaybackState(1,old,{subtitle:'embedded:2'});
 const barrier=f.flushMediaPlaybackState();await tick();f.calls[0].reject(Object.assign(new Error('owned changed source'),{status:409}));
 assert.equal(await barrier,true);assert.equal(await f.saveMediaPlaybackState(1,old,{delay:1}),true);assert.equal(f.calls.length,1);
 const fresh={...f.state(),source:'b'.repeat(64)};f.saveMediaPlaybackState(1,fresh,{audio:2});const next=f.flushMediaPlaybackState();await tick();
 assert.equal(f.calls[1].body.source,fresh.source);assert.equal(f.calls[1].body.changes.subtitle,undefined);
 f.calls[1].resolve({});assert.equal(await next,true);
});

test('retry limit is per media, not a shared limit that skips other failed videos',async t=>{
 const f=fixture(t);f.saveMediaPlaybackState(1,f.state(),{delay:.2});f.saveMediaPlaybackState(2,f.state(),{audio:2});
 const barrier=f.flushMediaPlaybackState();await tick();assert.equal(f.calls.length,2);fail(f.calls[0]);fail(f.calls[1]);await tick();
 assert.equal(f.calls.length,3);assert.ok(f.calls[2].url.includes('/1/'));fail(f.calls[2]);await tick();
 assert.equal(f.calls.length,4);assert.ok(f.calls[3].url.includes('/2/'));fail(f.calls[3]);assert.equal(await barrier,false);
 const retry=f.flushMediaPlaybackState();await tick();f.calls[4].resolve({});await tick();f.calls[5].resolve({});assert.equal(await retry,true);
});

test('a new edit that also fails during the shared round remains failed for the next confirmation',async t=>{
 const f=fixture(t),state=f.state();f.saveMediaPlaybackState(1,state,{subtitle:'embedded:2'});
 const barrier=f.flushMediaPlaybackState();await tick();fail(f.calls[0]);await tick();
 f.saveMediaPlaybackState(1,state,{delay:.9});fail(f.calls[1]);await tick();fail(f.calls[2]);
 assert.equal(await barrier,false);await tick();assert.equal(f.calls.length,3);
 const retry=f.flushMediaPlaybackState();await tick();assert.equal(f.calls.length,4);
 assert.equal(f.calls[3].body.changes.delay,.9);assert.equal(f.calls[3].body.changes.subtitle,'embedded:2');
 f.calls[3].resolve({});assert.equal(await retry,true);assert.equal(state.delay,.9);
});
