type Metric={pid:number;type:string;memory:{workingSetSize:number;privateBytes?:number}};
type Roles={main:number;libraryRenderer?:number;controlsRenderer?:number};
const knownTypes=new Set(['Browser','Tab','GPU','Utility','Zygote','Sandbox helper','PPAPI plugin','Unknown']);
const memoryValue=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;

// Called on explicit diagnostic requests only. Whitelist fields rather than
// exporting process names, command lines, service names or source paths.
export function processMemorySnapshot(metrics:readonly Metric[],roles:Roles,sampledAt=Date.now()){
  return {sampledAt,unit:'KiB',scope:'electron-processes-only',gpuWorkingSetIsNotVram:true,truncated:metrics.length>32,
    processes:metrics.slice(0,32).map(metric=>{
      const pid=Number.isSafeInteger(metric.pid)&&metric.pid>0?metric.pid:null;
      const role=pid!==null&&pid===roles.main?'main':pid!==null&&pid===roles.libraryRenderer?'library-renderer':pid!==null&&pid===roles.controlsRenderer?'controls-renderer':'other';
      return {pid,role,type:knownTypes.has(metric.type)?metric.type:'Other',workingSetKiB:memoryValue(metric.memory.workingSetSize),privateKiB:memoryValue(metric.memory.privateBytes)};
    })};
}
