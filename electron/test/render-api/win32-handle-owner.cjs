// Parent owns its duplicate. A crashed child cannot skip the parent's cleanup.
function win32Api(koffi){
 const lib=koffi.load('kernel32.dll');
 return {
  self:lib.func('void * __stdcall GetCurrentProcess()'),
  open:lib.func('void * __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)'),
  duplicate:lib.func('int __stdcall DuplicateHandle(void *source, void *handle, void *target, _Out_ void **copy, uint32_t access, int inherit, uint32_t flags)'),
  close:lib.func('int __stdcall CloseHandle(void *handle)'),
  valid:lib.func('int __stdcall GetHandleInformation(void *handle, _Out_ uint32_t *flags)'),
  error:lib.func('uint32_t __stdcall GetLastError()')
 };
}
function createHandleOwner({pid,api,inFlight=()=>0}){
 if(!Number.isSafeInteger(pid)||pid<=0||pid>0xffffffff)throw new Error('Invalid owned child pid');
 let lease=null,disposed=false;const stats={created:0,closed:0};
 function acquire(value){
  if(disposed)throw new Error('Handle admission closed');
  if(typeof value!=='string'||!/^\d{1,20}$/.test(value))throw new Error('Invalid source handle');
  const source=BigInt(value);if(source<=0n||source>0x7fffffffffffffffn)throw new Error('Invalid source handle');
  if(lease){if(lease.source!==source)throw new Error('Unexpected shared surface generation');return Buffer.from(lease.buffer);}
  const processHandle=api.open(0x40,0,pid);if(!processHandle)throw new Error('Open owned native process: '+api.error());
  const copy=[null];let error;
  try{if(!api.duplicate(processHandle,source,api.self(),copy,0,0,2)||!copy[0])throw new Error('Duplicate shared texture: '+api.error());}
  catch(e){error=e;}
  if(!api.close(processHandle))error??=new Error('Close native process handle: '+api.error());
  if(error){if(copy[0]&&!api.close(copy[0]))error=new Error('Duplicate cleanup failed: '+api.error(),{cause:error});throw error;}
  const handle=BigInt(copy[0]),buffer=Buffer.alloc(8);buffer.writeBigUInt64LE(handle);
  lease={source,handle,buffer};stats.created++;return Buffer.from(buffer);
 }
 function close(){
  if(inFlight()!==0)throw new Error('Cannot close shared handle with GPU readers');
  if(lease){if(!api.close(lease.handle))throw new Error('Close shared texture handle: '+api.error());stats.closed++;lease=null;}
  disposed=true;
 }
 return {acquire,close,stats:()=>({...stats,live:stats.created-stats.closed,disposed,valid:lease?!!api.valid(lease.handle,[0]):false})};
}
module.exports={createHandleOwner,win32Api};
