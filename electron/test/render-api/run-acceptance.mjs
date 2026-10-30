// Explicit isolated M2 profiles; never invokes the AVHub release builder.
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const profiles={
 'd3d11-av1':{backend:'d3d11',sample:'Framecode-v3-3840x2160-av1.mkv'},
 'd3d11-portrait':{backend:'d3d11',sample:'Precision-SDR10-2160x3840.mkv',tenBit:true},
 'd3d11-long':{backend:'d3d11',sample:'long-run/Precision-SDR10-Long-v1-3840x2160.mkv',tenBit:true,seconds:900},
 'opengl-sdr':{backend:'opengl',sample:'Framecode-v2-640x360.mp4'},
};
const faults={exit:'AVHUB_RENDER_INJECT_EXIT',render:'AVHUB_RENDER_INJECT_RENDER',pipe:'AVHUB_RENDER_INJECT_PIPE',import:'AVHUB_RENDER_INJECT_IMPORT',device:'AVHUB_RENDER_INJECT_WEBGPU',boundary:'AVHUB_RENDER_TEST_FAILURE_BOUNDARY'};
const [profile,...args]=process.argv.slice(2);assert.ok(profiles[profile],'Choose profile: '+Object.keys(profiles).join(', '));
assert.ok(args.every(a=>a==='--prepare-package'||a==='--packaged'||a.startsWith('--fault=')),'Unknown argument');
const fault=args.find(a=>a.startsWith('--fault='))?.slice(8);assert.ok(!fault||faults[fault]||fault==='startup','Unknown fault');
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^AVHUB_RENDER_/.test(k)&&!['ELECTRON_RUN_AS_NODE','NODE_OPTIONS'].includes(k)));
const p=profiles[profile];Object.assign(env,{AVHUB_RENDER_BACKEND:p.backend,AVHUB_RENDER_SAMPLE:p.sample,AVHUB_RENDER_SHARED_TEXTURE:'1',AVHUB_RENDER_FP16:'1',...p.tenBit?{AVHUB_RENDER_SDR10:'1'}:{}});
if(fault&&fault!=='startup')env[faults[fault]]='1';
else if(!fault)Object.assign(env,{AVHUB_RENDER_STRESS_SEEKS:'16',AVHUB_RENDER_SEEK_ROUNDS:'3',AVHUB_RENDER_OVERLAY_TEST:'1',AVHUB_RENDER_TEST_CLOSE_BOUNDARY:'1',...p.seconds?{AVHUB_RENDER_SOAK_SECONDS:String(p.seconds)}:{}});
const run=(name,extra=[])=>{const result=spawnSync(process.execPath,[path.join(import.meta.dirname,name),...extra],{cwd:path.resolve(import.meta.dirname,'../../..'),env,stdio:'inherit',windowsHide:true,timeout:1800000});assert.equal(result.status,0,result.error?.message||'M2 profile failed: '+name);};
if(args.includes('--prepare-package'))run('package.mjs');
run(fault==='startup'?'startup-fault.mjs':'spike.mjs',args.includes('--packaged')?['--packaged']:[]);
