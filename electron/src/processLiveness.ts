/** Probe only a PID obtained from our own WebContents. Signal 0 never kills.
 * Access denied is unknown, not proof that a process exited. */
export function ownedRendererExited(pid:number,probe:(pid:number,signal:0)=>unknown=process.kill){
  if(!Number.isSafeInteger(pid)||pid<=0||pid===process.pid)return false;
  try{probe(pid,0);return false;}
  catch(error){return Boolean(error&&typeof error==='object'&&'code' in error&&error.code==='ESRCH');}
}
