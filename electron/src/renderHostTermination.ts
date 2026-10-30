// Keep process diagnostics useful without logging arbitrary stderr or paths.
export function renderHostTermination(code:number|null,signal:string|null,stderr:string,stderrBytes:number,spawnError:string|null=null){
 const match=stderr.match(/\b(DllNotFoundException|BadImageFormatException|EntryPointNotFoundException|TypeInitializationException|Exception): native host could not start\b/);
 return {exitCode:code,statusHex:code===null||spawnError!==null?null:'0x'+(code>>>0).toString(16).toUpperCase().padStart(8,'0'),signal,spawnError,stderrBytes,startupException:match?.[1]??null};
}
