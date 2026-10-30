// M2 eligibility assessment only. It never authorizes unverified HDR playback.
function assessDisplay(snapshot){
 const blocked=(state,reason,output=null,path=null)=>({state,reason,signalCandidate:false,hdrPlaybackAllowed:false,route:'unverified',output,path});
 if(!snapshot||snapshot.queryComplete!==true||!Array.isArray(snapshot.outputs)||!Array.isArray(snapshot.advancedPaths)||!snapshot.selectedMonitor)return blocked('unknown','Native display evidence incomplete');
 const matches=snapshot.outputs.filter(o=>o?.attached===true&&o.monitor===snapshot.selectedMonitor);
 if(matches.length!==1)return blocked('unknown','Window monitor mapping is missing or ambiguous');
 const output=matches[0],paths=snapshot.advancedPaths.filter(p=>p?.deviceName===output.deviceName);
 if(paths.length!==1)return blocked('unknown','Active display path mapping is missing or cloned',output);
 const path=paths[0];
 if(path.query!=='advanced-color-info-2'||typeof path.supported!=='boolean'||typeof path.limitedByPolicy!=='boolean'||typeof path.hdrSupported!=='boolean'||typeof path.hdrUserEnabled!=='boolean'||typeof path.active!=='boolean'||!Number.isInteger(path.activeColorMode))return blocked('unknown','Explicit HDR support and active mode are unavailable',output,path);
 if(path.limitedByPolicy===true)return blocked('unavailable','Advanced color limited by OS policy',output,path);
 if(!path.hdrSupported)return blocked('unsupported','OS does not report HDR support for this active path',output,path);
 if(!path.supported)return blocked('inconsistent','HDR and advanced color support disagree',output,path);
 if(!path.hdrUserEnabled&&path.activeColorMode!==2)return blocked('disabled','HDR is not enabled by the user',output,path);
 if(!path.hdrUserEnabled||!path.active||path.activeColorMode!==2)return blocked('inconsistent','HDR support, user enablement and active mode disagree',output,path);
 if(!Number.isInteger(output.bitsPerColor)||!Number.isInteger(path.bitsPerColor)||output.bitsPerColor<10||path.bitsPerColor<10||output.colorSpace!==12)return blocked('inconsistent','Active output is not confirmed 10-bit PQ BT.2020',output,path);
 return {state:'signal-candidate',reason:'OS HDR signal is active; end-to-end playback remains unverified',signalCandidate:true,hdrPlaybackAllowed:false,route:'unverified',output,path};
}
module.exports={assessDisplay};
