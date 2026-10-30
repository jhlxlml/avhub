// Evaluates recorded M2 facts. Synthetic unit fixtures do not certify playback.
const {assessDrops,summarize}=require('./soak-summary.cjs');
const {convergence}=require('./resource-convergence.cjs');
const roles=['long','av1','portrait','exit','device','boundary','import','render','pipe','startup'];
function assessCohort({sourceFingerprint,dllSha256,entries}){
 const failures=[];const check=(condition,why)=>{if(!condition)failures.push(why);};const fp=/^[a-f0-9]{64}$/;
 check(fp.test(sourceFingerprint||'')&&fp.test(dllSha256||''),'Missing current input identities');
 for(const role of roles){
  const e=entries?.[role],r=e?.report,b=e?.binding;
  if(!r||!b){failures.push(role+': missing report/runtime binding');continue;}
  const need=(v,why)=>check(v,role+': '+why);
  need(r.completed===true,'acceptance not completed');
  need(r.sourceFingerprint===sourceFingerprint&&r.artifact?.sourceFingerprint===sourceFingerprint,'different or missing runtime source fingerprint');
  need(r.artifact?.verified===true&&e.verification?.verified===true&&r.artifact.manifestSha256===e.verification.manifestSha256,'complete runtime attestation unavailable');
  need(b.backend==='d3d11'&&b.dllSha256===dllSha256,'different renderer or libmpv');
  need(b.mediaSha256===b.metadataSha256&&fp.test(b.mediaSha256||''),'fixture bytes not bound to probed source');
  need(b.primaries==='bt709'&&b.transfer==='bt709'&&b.matrix==='bt709','unverified color metadata');
  if(role==='startup'){need(r.noOrphan===true&&r.transfers?.imports===0&&r.transfers?.released===0,'initialization failure leaked host or frame');continue;}
  need(r.cleanExit===true&&r.sourceUnchanged===true,'unclean exit/source mutation');
  need(r.runtime?.packaged===true&&r.runtime.backend==='d3d11'&&r.runtime.dllSha256===dllSha256,'not the claimed packaged backend');
  need(r.initial?.renderApi==='d3d11'&&r.initial.vo==='libmpv'&&r.initial.hwdec==='d3d11va','expected native rendering/decoder unavailable');
  const t=r.transferStats,h=r.handleCleanup;
  need(t?.imports>0&&t.imports===t.released&&t.maxInFlight<=1&&t.importFailures===(role==='import'?1:0),'unreleased/failed shared texture references');
  need(h?.created===1&&h.closed===1&&h.live===0&&h.valid===false,'parent NT lease not reclaimed');
  if(['long','av1','portrait'].includes(role)){
   need(r.seeks?.length>=60&&r.seeks.every(s=>s.frameError===0&&Number.isSafeInteger(s.expectedFrame)&&s.expectedFrame>=0&&Number.isSafeInteger(s.presentedPixels?.top)&&s.presentedPixels.top===s.expectedFrame),'missing/inaccurate real pixel seeks');
   const s=r.shutdownEvidence;need(s?.hostExited===true&&s.nativeExitCode===0&&s.forcedTermination===false,'healthy close required native force termination');
   need(r.maximizeRestorePassed===true&&r.overlayAcceptance&&r.fullscreenOverlayAcceptance,'missing window/React/subtitle overlay checks');
  }
  if(role==='av1')need(b.codec==='av1'&&b.width===3840&&b.height===2160,'not the required 4K AV1 source');
  if(['long','portrait'].includes(role)){
   need(b.codec==='hevc'&&b.pixelFormat==='yuv420p10le'&&b.floatingPoint===true,'not original SDR10/F16');
   need(b.width===(role==='portrait'?2160:3840)&&b.height===(role==='portrait'?3840:2160),'incorrect original geometry');
   need(r.sourcePrecision?.levels===877&&r.precisionProbe?.plateauLevels===877&&r.transportPrecision?.maxAbsoluteError<=1e-6,'unverified 10-bit precision');
  }
  if(role==='exit')need(r.injectedProcessExitHandled===true,'process exit not tested');
  if(role==='device')need(r.deviceLoss?.passed===true,'real WebGPU device loss not tested');
  if(role==='boundary')need(r.failureBoundary?.passed===true&&r.failureBoundary.held>r.failureBoundary.lastAtHold&&r.failureBoundary.before.imports===r.failureBoundary.after.imports,'in-flight failure admission not tested');
  if(role==='import')need(r.injectedImportFailureHandled===true,'import error not tested');
  if(role==='render')need(r.injectedRenderFailureHandled===true,'render thread failure not tested');
  if(role==='pipe')need(r.injectedCommandPipeFailureHandled===true,'native pipe failure not tested');
 }
 const long=entries?.long?.report,s=long?.soakAcceptance;let drops,pixelProgress,resource;
 if(s){
  check(s.completed===true&&s.playbackElapsedMs>=900000&&entries.long.binding.durationSec>=950,'long: not fifteen minutes of continuous source');
  check(s.before?.loop==='no'&&s.after?.loop==='no','long: short loop cannot substitute for continuous timeline');
  check(s.samples?.length>=400,'long: insufficient actual pixel samples');
  try{drops=assessDrops([s.before,...s.samples.map(r=>r.native),s.after],s.playbackElapsedMs);check(drops.passed,'long: drop gate failed or counters unavailable');
   const summary=summarize(s);pixelProgress=summary.pixelProgress;check(pixelProgress.ambiguousPairs===0&&Math.abs(pixelProgress.sourceTimeToWallRatio-1)<.01,'long: pixel progress stalled or ambiguous');
   resource=convergence(s.idleBefore,s.idleAfter,s.samples);check(resource.handles.peakPositiveGrowth<=16&&resource.handles.settledPositiveGrowth<=8&&resource.handles.idleRange<=8,'long: handles did not converge');
   check(resource.privateBytes.peakPositiveGrowth<=64*1024**2&&resource.gpu.peakPositiveGrowth<=64*1024**2,'long: native RAM/GPU growth exceeded budget');
  }catch(error){failures.push('long: incomplete raw evidence: '+error.message);}
 }else failures.push('long: no endurance record');
 return {schema:1,scope:'Current-source packaged SDR M2 cohort only; not physical HDR/DPI or production integration',sourceFingerprint,dllSha256,softwareCohortPassed:failures.length===0,fullM2GatePassed:false,failures,drops,pixelProgress,resource};
}
module.exports={assessCohort,roles};
