// Only preflight snapshots/cache release are cancellable. Never wrap a rename,
// recycle, restore, deletion, or result acknowledgement in this deadline.
export const FILE_PREVIEW_TIMEOUT_MS=10_000;
export function cancellableFilePreview(action:unknown):boolean {
  return ['preview','preview-records','release-preview','release-record-preview'].includes(String(action));
}

export class FilePreviewRequest {
  private controller=new AbortController();
  constructor(readonly id:string,private timeoutMs=FILE_PREVIEW_TIMEOUT_MS){}
  cancel(message='已取消预检，未执行文件修改'):void {
    if(!this.controller.signal.aborted)this.controller.abort(new Error(message));
  }
  async run<T>(read:(signal:AbortSignal)=>Promise<T>):Promise<T>{
    const signal=this.controller.signal;
    signal.throwIfAborted();
    let rejectAbort!:(reason:unknown)=>void;
    const aborted=new Promise<never>((_,reject)=>{rejectAbort=reject;});
    const onAbort=()=>rejectAbort(signal.reason);
    signal.addEventListener('abort',onAbort,{once:true});
    const timer=setTimeout(()=>this.cancel('预检超时，未执行文件修改；可取消或稍后重新预检'),this.timeoutMs);
    try {
      // Include response-body decoding in the deadline. The race also releases
      // the UI if a faulty transport does not honour its AbortSignal.
      return await Promise.race([Promise.resolve().then(()=>{signal.throwIfAborted();return read(signal);}),aborted]);
    }finally{clearTimeout(timer);signal.removeEventListener('abort',onAbort);}
  }
}
