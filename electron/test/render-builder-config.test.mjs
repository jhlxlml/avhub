// Configuration/preflight checks only. Does not invoke electron-builder.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import path from 'node:path';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'../..');
const staged=JSON.parse(readFileSync(path.join(root,'build/render-runtime-staging.json'),'utf8'));
const candidate=path.basename(staged.folder);process.env.AVHUB_RENDER_RUNTIME_CANDIDATE=candidate;
const config=require('../native-render.builder.cjs');
test('local acceptance configuration includes actual native resources outside ASAR',async()=>{
 assert.equal(config.extraResources.at(-1).from,staged.folder);assert.equal(config.extraResources.at(-1).to,'native-render');
 assert.equal(config.publish,null);assert.ok(config.directories.output.startsWith(path.join('build','native-render-acceptance-')));
 assert.match(config.win.artifactName,/render-acceptance/);
 await config.beforePack();
 for(const name of ['licenses/mpv/LICENSE.GPL','licenses/ffmpeg/COPYING.GPLv3','licenses/ffmpeg/LICENSE.md','licenses/build-materials.json'])assert.ok(readFileSync(path.join(staged.folder,name)).length>0);
 assert.equal(JSON.parse(readFileSync(path.join(staged.folder,'licenses/build-materials.json'),'utf8')).distributionReady,false);
});
test('ordinary package configuration and stable artifacts remain unchanged',()=>{
 const ordinary=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).build;
 assert.equal(ordinary.extraResources.some(r=>r.to==='native-render'),false);
 assert.equal(ordinary.directories.output,'dist/electron');assert.equal(ordinary.win.artifactName,'AVHub-portable-${version}-${arch}.${ext}');
});
test('local acceptance configuration refuses stable-tag publishing context',async()=>{
 const previous=process.env.GITHUB_REF;process.env.GITHUB_REF='refs/tags/v0.2.16';
 try{await assert.rejects(config.beforePack(),/cannot publish/);}finally{if(previous===undefined)delete process.env.GITHUB_REF;else process.env.GITHUB_REF=previous;}
});

test('replayed closure resources pass local preflight without opening packaged playback',async()=>{
 const previous=process.env.AVHUB_RENDER_RUNTIME_CANDIDATE,previousRef=process.env.GITHUB_REF;
 const file=require.resolve('../native-render.builder.cjs');
 const stagedReplay=JSON.parse(readFileSync(path.join(root,'build/replayed-render-staging.json'),'utf8'));
 try{
  process.env.AVHUB_RENDER_RUNTIME_CANDIDATE=path.basename(stagedReplay.folder);delete require.cache[file];
  const replay=require(file);
  assert.equal(replay.publish,null);
  assert.equal(replay.extraResources.at(-1).from,stagedReplay.folder);
  assert.equal(replay.extraResources.at(-1).to,'native-render');
  assert.ok(replay.extraFiles.some(file=>file.to==='Start-render-acceptance.cmd'&&readFileSync(path.join(root,file.from),'utf8').includes('AVHUB_DATA_DIR=%~dp0AVHub-data-acceptance')));
  const markerResource=replay.extraResources.find(r=>r.to==='local-render-acceptance.json');
  assert.ok(markerResource);
  const marker=JSON.parse(readFileSync(markerResource.from,'utf8'));
  assert.equal(marker.purpose,'local-render-acceptance');
  assert.equal(marker.candidate,path.basename(stagedReplay.folder));
  assert.equal(marker.distributionReady,false);
  await replay.beforePack();
  for(const name of ['materials/notices/avhub/LICENSE','materials/notices/gcc-mingw-w64-base/copyright','materials/notices/mingw-w64-common/copyright'])assert.ok(readFileSync(path.join(stagedReplay.folder,name)).length>0);
  const {renderRuntimeLayout}=require('../dist/renderRuntimeLayout.js');
  assert.throws(()=>renderRuntimeLayout(root,true,'C:/resources',path.basename(stagedReplay.folder)),/发行验收/);
  process.env.GITHUB_REF='refs/tags/forbidden-local-acceptance';
  await assert.rejects(replay.beforePack(),/cannot publish/);
 }finally{
  if(previousRef===undefined)delete process.env.GITHUB_REF;else process.env.GITHUB_REF=previousRef;
  if(previous===undefined)delete process.env.AVHUB_RENDER_RUNTIME_CANDIDATE;else process.env.AVHUB_RENDER_RUNTIME_CANDIDATE=previous;
  delete require.cache[file];
 }
});
