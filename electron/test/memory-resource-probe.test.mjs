// Probe/ownership contracts, not real-memory performance results.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {advanceLibraryPage} from './library-page-driver.mjs';
import {summarizeMemoryResources} from './memory-resource-summary.mjs';
const source=readFileSync(new URL('./memory-resource-preload.cjs',import.meta.url),'utf8');

test('test preload exposes one read-only bounded numeric snapshot with no identities',()=>{
 let exposed,calls=0;
 runInNewContext(source,{
  require:name=>{assert.equal(name,'electron');return {
   contextBridge:{exposeInMainWorld:(key,api)=>{assert.equal(key,'__avhubMemoryResources');exposed=api;}},
   webFrame:{getResourceUsage:()=>{calls++;return {images:{count:3,size:1024,liveSize:0,path:'secret'},scripts:{count:-1,size:NaN,liveSize:Infinity},extra:{path:'secret'}};}},
  };},performance:{memory:{usedJSHeapSize:4096}},
 });
 assert.equal(calls,0,'no periodic/eager resource polling');
 assert.deepEqual(Object.keys(exposed),['snapshot']);
 const value=JSON.parse(JSON.stringify(exposed.snapshot()));
 assert.equal(calls,1);
 assert.deepEqual(Object.keys(value.resources),['images','scripts','cssStyleSheets','xslStyleSheets','fonts','other']);
 assert.deepEqual(value.resources.images,{count:3,size:1024,liveSize:0});
 assert.deepEqual(value.resources.scripts,{count:null,size:null,liveSize:null});
 assert.deepEqual(value.resources.fonts,{count:null,size:null,liveSize:null});
 assert.equal(value.jsHeapUsedBytes,4096);assert.doesNotMatch(JSON.stringify(value),/secret/);
});

test('resource probe and pure frame observer stay outside production entry points',()=>{
 for(const file of ['main','preload']){
  assert.doesNotMatch(readFileSync(new URL(`../src/${file}.ts`,import.meta.url),'utf8'),/__avhubMemoryResources|memory-resource-preload/);
 }
 const observer=readFileSync(new URL('./chromium-cycle-observer.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(observer,/import\s|playwright|collectGarbage|clearCache/);
 const packageInfo=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url),'utf8'));
 assert.ok(!packageInfo.build.files.some(value=>value.includes('electron/test')));
 assert.doesNotMatch(source,/ipcRenderer|clearCache|clearStorage|setInterval|setTimeout|collectGarbage/);
});

test('page driver follows icon accessible names, reverses at edges and waits for disabled controls',()=>{
 for(const [page,forward,disabled,expected] of [[1,false,false,2],[23,true,false,22],[5,true,false,6],[5,false,false,4],[5,true,true,null]]){
  let clicked=0,label='';
  const result=runInNewContext(`(${advanceLibraryPage.toString()})(${forward})`,{
   URL,location:{href:`http://127.0.0.1/?page=${page}`},
   document:{querySelector:selector=>{
    if(selector==='[aria-label="跳转页码"]')return {max:'23'};
    label=selector;return {textContent:'',disabled,click:()=>clicked++};
   }},
  });
  assert.equal(result?.page??null,expected);assert.equal(clicked,disabled?0:1);
  assert.match(label,/aria-label="(?:下一页|上一页)"/);
 }
});

test('resource summaries keep missing measurements unknown and preserve raw values',()=>{
 const value=summarizeMemoryResources([
  {},{resourceUsage:{resources:{images:{count:3,size:1024,liveSize:0}},jsHeapUsedBytes:4096}},
  {resourceUsage:{resources:{images:{count:5,size:2048,liveSize:-1}},jsHeapUsedBytes:null}},
 ]);
 assert.equal(value.samples,2);assert.deepEqual(value.caches.images.count,{min:3,median:3,max:5});
 assert.deepEqual(value.caches.images.liveSize,{min:0,median:0,max:0});
 assert.deepEqual(value.caches.fonts.count,{min:null,median:null,max:null});
 assert.deepEqual(summarizeMemoryResources([]).jsHeapUsedBytes,{min:null,median:null,max:null});
});
