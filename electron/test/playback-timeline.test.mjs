import {test} from 'node:test';
import assert from 'node:assert/strict';
import {frameIntervals,installPlaybackTimeline} from './playback-timeline.mjs';

test('frame accounting preserves drops across pause and resume boundaries',()=>{
 const kinds=['installed','pause-call','pause','paused-settled','play-call','playing','phase-end'];
 const totals=[10,20,21,21,21,23,40],drops=[0,1,2,2,2,3,4];
 const rows=kinds.map((kind,n)=>({kind,at:n*10,total:totals[n],dropped:drops[n]}));
 const result=frameIntervals(rows);
 assert.deepEqual(result.map(row=>row.state),['playing','transition','paused','paused','transition','playing']);
 assert.equal(result.reduce((sum,row)=>sum+row.dropped,0),4);
 assert.equal(result.reduce((sum,row)=>sum+row.total,0),30);
 assert.equal(result.filter(row=>row.state==='playing').reduce((sum,row)=>sum+row.dropped,0),2);
});

test('empty and single observations do not invent frame intervals',()=>{
 assert.deepEqual(frameIntervals([]),[]);
 assert.deepEqual(frameIntervals([{kind:'installed',at:0,total:0,dropped:0}]),[]);
});

test('fetch observation preserves response identity/body and original rejection',async()=>{
 const previous=globalThis.window;
 const response=new Response('{"progress":3}',{headers:{'x-avhub-save-trace':'17'}});
 const failure=new Error('owned failure');let calls=0;
 const events=new Map();
 globalThis.window={fetch:async()=>{calls++;if(calls===3)throw failure;return response;}};
 try{
  installPlaybackTimeline({currentTime:3,paused:true,seeking:false,readyState:4,
   getVideoPlaybackQuality:()=>({totalVideoFrames:20,droppedVideoFrames:2}),
   addEventListener:(event,callback)=>events.set(event,callback)});
  const normal=await window.fetch('/api/scan');assert.equal(normal,response);
  const saved=await window.fetch('/api/media/1/progress',{method:'PUT',body:JSON.stringify({progress:3,updated_at:12})});
  assert.equal(saved,response);assert.equal(saved.bodyUsed,false);
  events.get('pause')();
  await assert.rejects(window.fetch('/api/media/1/progress',{method:'PUT',body:'{}'}),error=>error===failure);
  assert.deepEqual(window.__playbackTimeline.rows.map(row=>row.kind),['installed','fetch-start','fetch-headers','pause','fetch-start','fetch-error']);
  assert.equal(window.__playbackTimeline.rows[2].scope,'17');
  assert.equal(await saved.text(),'{"progress":3}');
 }finally{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});

test('repeated player cycles restore fetch and remove all video listeners',async()=>{
 const previous=globalThis.window,handlers=new Map();let finish;
 const original=()=>new Promise(resolve=>finish=resolve);
 globalThis.window={fetch:original};
 const video={currentTime:3,paused:true,seeking:false,readyState:4,
  getVideoPlaybackQuality:()=>({totalVideoFrames:20,droppedVideoFrames:2}),
  addEventListener:(kind,fn)=>handlers.set(kind,fn),removeEventListener:(kind,fn)=>{assert.equal(handlers.get(kind),fn);handlers.delete(kind);}};
 try{
  installPlaybackTimeline(video);const first=window.__playbackTimeline;
  const pending=window.fetch('/api/media/1/progress',{method:'PUT',body:'{}'});
  const count=first.rows.length;assert.equal(first.stop(),true);assert.equal(window.fetch,original);assert.equal(handlers.size,0);
  const response=new Response('{}');finish(response);assert.equal(await pending,response);assert.equal(first.rows.length,count);
  installPlaybackTimeline(video);const second=window.__playbackTimeline;assert.notEqual(first,second);
  assert.equal(first.stop(),true);assert.notEqual(window.fetch,original,'An old cleanup cannot remove the new observation');
  assert.equal(second.stop(),true);assert.equal(window.fetch,original);assert.equal(handlers.size,0);
 }finally{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});
