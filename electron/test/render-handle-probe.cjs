// Test-only type counts for one explicitly owned helper. No object names or
// media paths/data are queried. Reuses the bounded x64 snapshot layout
// already exercised by the isolated M2 own-process probe.
const path=require('node:path');
module.exports=function createProbe(root){
 const ffi=require(path.join(root,'build/libmpv-render-spike/ffi/node_modules/@koromix/koffi-win32-x64/win32_x64/koffi.node'));
 if(process.platform!=='win32'||process.arch!=='x64'||ffi.version!=='3.3.4')throw new Error('Handle probe platform mismatch');
 const k=ffi.load('kernel32.dll'),n=ffi.load('ntdll.dll');
 const open=k.func('void * __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)'),close=k.func('int __stdcall CloseHandle(void *handle)'),self=k.func('void * __stdcall GetCurrentProcess()'),dup=k.func('int __stdcall DuplicateHandle(void *source, void *handle, void *target, _Out_ void **copy, uint32_t access, int inherit, uint32_t flags)'),image=k.func('int __stdcall QueryFullProcessImageNameW(void *process, uint32_t flags, void *buffer, _Inout_ uint32_t *size)'),query=n.func('int __stdcall NtQueryInformationProcess(void *process, int type, void *buffer, uint32_t size, _Out_ uint32_t *needed)'),object=n.func('int __stdcall NtQueryObject(void *handle, int type, void *buffer, uint32_t size, _Out_ uint32_t *needed)');
 const enumModules=k.func('int __stdcall K32EnumProcessModulesEx(void *process, void *modules, uint32_t bytes, _Out_ uint32_t *needed, uint32_t filter)'),moduleInfo=k.func('int __stdcall K32GetModuleInformation(void *process, void *module, void *info, uint32_t bytes)'),moduleName=k.func('uint32_t __stdcall K32GetModuleBaseNameW(void *process, void *module, void *name, uint32_t count)'),threadPid=k.func('uint32_t __stdcall GetProcessIdOfThread(void *thread)'),threadId=k.func('uint32_t __stdcall GetThreadId(void *thread)'),threadInfo=n.func('int __stdcall NtQueryInformationThread(void *thread, int type, void *buffer, uint32_t size, _Out_ uint32_t *needed)');
 return pid=>{
  if(!Number.isSafeInteger(pid)||pid<=0)throw new Error('Invalid owned helper PID');const processHandle=open(0x450,0,pid);if(!processHandle)throw new Error('Owned helper unavailable');
  try{
   const file=Buffer.alloc(4096),length=[2048];if(!image(processHandle,0,file,length)||path.resolve(file.toString('utf16le',0,length[0]*2)).toLowerCase()!==path.join(root,'build/native-render/AVHubNativeRender.exe').toLowerCase())throw new Error('Not the AVHub owned render helper');
   const bytes=Buffer.alloc(1024**2),needed=[0],status=query(processHandle,51,bytes,bytes.length,needed);if(status<0)throw new Error('Bounded handle snapshot unavailable: '+status);const count=Number(bytes.readBigUInt64LE(0));if(!Number.isSafeInteger(count)||count<0||count>(bytes.length-16)/40)throw new Error('Handle table exceeds bound');
   const modules=[],moduleBytes=Buffer.alloc(65536),moduleNeeded=[0];if(enumModules(processHandle,moduleBytes,moduleBytes.length,moduleNeeded,3)&&moduleNeeded[0]<=moduleBytes.length){for(let at=0;at<moduleNeeded[0];at+=8){const handle=moduleBytes.readBigUInt64LE(at),info=Buffer.alloc(24),name=Buffer.alloc(520);if(moduleInfo(processHandle,handle,info,info.length)){const length=moduleName(processHandle,handle,name,260);modules.push({base:info.readBigUInt64LE(0),end:info.readBigUInt64LE(0)+BigInt(info.readUInt32LE(8)),name:length?name.toString('utf16le',0,length*2):'unnamed-module'});}}}
   const names=new Map(),counts={},threadOwners={},threads=[];let failed=0;
   for(let i=0;i<count;i++){
    const at=16+i*40,index=bytes.readUInt32LE(at+28);let name=names.get(index);
    if(!name){name='type-'+index;const copy=[null];if(dup(processHandle,bytes.readBigUInt64LE(at),self(),copy,0,0,2)&&copy[0]){
      try{const b=Buffer.alloc(4096);if(object(copy[0],2,b,b.length,needed)>=0){const size=b.readUInt16LE(0),text=b.readBigUInt64LE(8),base=BigInt(ffi.address(b)),offset=Number(text-base);if(size>0&&size<=256&&offset>=0&&offset+size<=b.length)name=b.toString('utf16le',offset,offset+size);}}finally{if(!close(copy[0]))throw new Error('Probe duplicate did not close');}
     }else failed++;names.set(index,name);
    }counts[name]=(counts[name]||0)+1;
    if(name==='Thread'){let owner='unavailable',id=null;const copy=[null];if(dup(processHandle,bytes.readBigUInt64LE(at),self(),copy,0,0,2)&&copy[0]){try{if(threadPid(copy[0])===pid){id=threadId(copy[0]);const address=Buffer.alloc(8);if(threadInfo(copy[0],9,address,address.length,needed)>=0){const start=address.readBigUInt64LE(0);owner=modules.find(m=>start>=m.base&&start<m.end)?.name??'unmapped-module';}}else owner='external-thread';}finally{if(!close(copy[0]))throw new Error('Probe thread duplicate did not close');}}threadOwners[owner]=(threadOwners[owner]||0)+1;threads.push({id,module:owner});}
   }
   return {count,counts,failedTypeQueries:failed,threadOwners,threads};
  }finally{if(!close(processHandle))throw new Error('Probe process handle did not close');}
 };
};
