import {developmentIndependentRuntime} from './development-independent-runtime.mjs';
// Serial runner: GPU desktop cases must never compete with each other.
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,openSync,closeSync,writeFileSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {playbackFixture} from '../electron/test/playback-fixtures.mjs';

const root=path.resolve(import.meta.dirname,'..'),desktop=process.argv.includes('--desktop');
mkdirSync(path.join(root,'build'),{recursive:true});
const dir=mkdtempSync(path.join(root,'build/playback-regression-')),rows=[];
const env={...process.env};
if(desktop){
 env.AVHUB_MPV_RUNTIME_CANDIDATE=developmentIndependentRuntime(root,env.AVHUB_MPV_RUNTIME_CANDIDATE);
 if(!env.AVHUB_MPV_RUNTIME_CANDIDATE)delete env.AVHUB_MPV_RUNTIME_CANDIDATE;
 if(!env.AVHUB_RENDER_RUNTIME_CANDIDATE){const staging=JSON.parse(readFileSync(path.join(root,'build/replayed-render-staging.json'),'utf8'));env.AVHUB_RENDER_RUNTIME_CANDIDATE=path.basename(staging.folder);}
 env.AVHUB_TEST_BASIC_SOURCE=playbackFixture('basic');
 env.AVHUB_TEST_HEVC_SOURCE=playbackFixture('hevc4k');
}
const cases=[
 ['build-identity',['scripts/write-build-info.mjs']],
 ['native-build-identity',['--test','electron/test/build-native-identity.test.mjs']],
 ['media-pool',['--test','electron/test/media-pool.test.mjs']],
 ['build',['node_modules/typescript/bin/tsc','-b']],
 ['electron-build',['node_modules/typescript/bin/tsc','-p','electron/tsconfig.json']],
 ['independent-runtime',['--test','electron/test/independent-runtime-layout.test.mjs','electron/test/native-runtime.test.mjs','electron/test/development-independent-runtime.test.mjs']],
 ['client',['electron/test/mpv-client.mjs']],
 ['write-queue',['--test','electron/test/mpv-write-queue.test.mjs']],
 ['runtime-prepare',['--test','electron/test/render-runtime-prepare.test.mjs']],
 ['release-journal',['--test','electron/test/desktop-release-check.test.mjs']],
 ['runtime-markers',['--test','electron/test/render-candidate-policy.test.mjs','electron/test/render-local-acceptance.test.mjs','electron/test/render-desktop-policy.test.mjs','electron/test/release-evidence.test.mjs']],
 ['render-priority',['--test','electron/test/render-priority.test.mjs']],
 ['output-failure',['--test','electron/test/render-output-failure.test.mjs','electron/test/frame-counter-summary.test.mjs','electron/test/render-frame-notifications.test.mjs','electron/test/frame-delivery-recorder.test.mjs','electron/test/frame-release-analysis.test.mjs']],
 ['shader-cache',['--test','electron/test/native-shader-cache.test.mjs']],
 ['engines',['--test','electron/test/mpv-engine.test.mjs','electron/test/independent-session.test.mjs']],
 ...(desktop?[
  ['frontend-build',['node_modules/vite/bin/vite.js','build']],
  ['runtime',['scripts/start-electron-dev.mjs','--check']],
  ['seek-default-settings',['electron/test/mpv-seek-settings.mjs']],
  ['native-async-api',['electron/test/render-async-api.mjs']],
  ['pointer-and-intent',['electron/test/render-playback-intent.mjs']],
  ['startup',['electron/test/render-startup-profile.mjs']],
  ['startup-intent',['electron/test/render-app-startup-intent.mjs']],
  ['gpu-init-failure',['electron/test/render-gpu-init-failure.mjs']],
  ['texture-release-timeout',['electron/test/render-release-timeout.mjs']],
  ['recovery',['electron/test/render-recovery.mjs']],
  ['independent',['electron/test/mpv-independent-reopen.mjs','3']],
  ['path-cycle',['electron/test/playback-path-cycle.mjs']],
  ['seek-matrix',['electron/test/mpv-seek-paired.mjs']],
 ]:[]),
];
for(const [name,args] of cases){
 const log=path.join(dir,name+'.log'),fd=openSync(log,'w'),began=Date.now();
 console.log('RUN '+name);
 const result=spawnSync(process.execPath,args,{cwd:root,env,stdio:['ignore',fd,fd],windowsHide:true,timeout:900000});closeSync(fd);
 const status=result.status===0?'PASS':'FAIL';
 rows.push({name,status,exitCode:result.status,signal:result.signal,error:result.error?.message??null,elapsedMs:Date.now()-began,log});
 writeFileSync(path.join(dir,'report.json'),JSON.stringify({desktop,independentRuntimeCandidate:env.AVHUB_MPV_RUNTIME_CANDIDATE??null,runtimeCandidate:env.AVHUB_RENDER_RUNTIME_CANDIDATE??null,fixtures:{basic:env.AVHUB_TEST_BASIC_SOURCE??null,hevc4k:env.AVHUB_TEST_HEVC_SOURCE??null},rows,unrun:cases.slice(rows.length).map(([name])=>name),skipped:desktop?[]:['real-Electron desktop cases: use --desktop'],passed:rows.every(row=>row.status==='PASS')},null,2));
 console.log(status+' '+name+' / '+result.status);
 if(status!=='PASS'){process.exitCode=1;break;}
}
console.log(path.join(dir,'report.json'));
