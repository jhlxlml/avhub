type Stage='renderer-starting'|'service-verified'|'preferences-ready'|'roots-ready'|'roots-error'|'startup-error'|'library-read-error';
const sent=new Set<Stage>();
// Fixed labels only; never send titles, source paths, search or error text.
export function traceStartup(stage:Stage){
 if(sent.has(stage))return;sent.add(stage);
 void window.avhubDesktop?.startupProgress?.(stage).catch(()=>{});
}
