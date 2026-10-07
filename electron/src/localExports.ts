import {dialog,shell,type BrowserWindow} from 'electron';
import {open,rename,unlink,lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';

export type ExportRequest={kind:'backup';jobId:string}|{kind:'diagnostics'};
type Source={filename:string;response:Response;maximum:number};
// Renderer selects only a known export kind/job. Paths are chosen by the native
// dialog and reveal operations use only exports successfully written here.
export class LocalExports {
  private active:AbortController|null=null;
  private saved=new Map<string,string>();
  constructor(private dataDirectory:()=>string,private source:(request:ExportRequest,signal:AbortSignal)=>Promise<Source>){}
  cancel(){this.active?.abort();return {ok:true};}
  async reveal(id:unknown){
    if(typeof id!=='string'||!this.saved.has(id))throw new Error('导出文件已过期，请重新保存');
    const filename=this.saved.get(id)!;await lstat(filename);shell.showItemInFolder(filename);return {ok:true};
  }
  async save(owner:BrowserWindow,value:unknown){
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('导出参数无效');
    const request=value as ExportRequest;
    if(request.kind==='backup'?Object.keys(value).length!==2||typeof request.jobId!=='string'||!/^([a-f0-9]{32})$/.test(request.jobId):request.kind!=='diagnostics'||Object.keys(value).length!==1)throw new Error('导出参数无效');
    if(this.active)throw new Error('请先完成当前导出');
    const controller=new AbortController();this.active=controller;
    let temporary='';let response:Response|undefined;
    try{
      // Obtain immutable metadata before opening the dialog. The service pins
      // the response for the entire stream, including time in the save dialog.
      const source=await this.source(request,controller.signal);response=source.response;
      if(!response.ok||!response.body)throw new Error('导出内容不可读取，请重试');
      const extension=path.extname(source.filename).toLowerCase();
      if(!['.zip','.db','.json'].includes(extension)||path.basename(source.filename)!==source.filename)throw new Error('导出格式无效');
      const chosen=await dialog.showSaveDialog(owner,{title:request.kind==='backup'?'保存媒体库备份':'保存运行诊断',defaultPath:source.filename,filters:[{name:extension==='.zip'?'完整备份':extension==='.db'?'数据库备份':'运行诊断',extensions:[extension.slice(1)]}]});
      if(chosen.canceled||!chosen.filePath||controller.signal.aborted)return {cancelled:true} as const;
      const destination=path.resolve(chosen.filePath);
      if(path.extname(destination).toLowerCase()!==extension)throw new Error(`请使用 ${extension} 文件扩展名`);
      const parent=await realpath(path.dirname(destination)),data=await realpath(this.dataDirectory());
      const target=path.join(parent,path.basename(destination)),relative=path.relative(data,target);
      if(!relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw new Error('请将导出保存到应用数据目录之外，避免覆盖媒体库和缓存');
      const existing=await lstat(target).catch((error:NodeJS.ErrnoException)=>{if(error.code!=='ENOENT')throw error;return null;});
      if(existing&&(existing.isSymbolicLink()||!existing.isFile()||existing.nlink>1))throw new Error('保存目标包含链接或不是普通文件，请选择其他位置');
      temporary=path.join(parent,`.avhub-export-${randomBytes(16).toString('hex')}.partial`);
      const file=await open(temporary,'wx');let bytes=0;
      try{
        for await(const chunk of response.body){
          controller.signal.throwIfAborted();bytes+=chunk.byteLength;
          if(bytes>source.maximum)throw new Error('导出内容超过允许大小，已取消保存');
          const buffer=Buffer.from(chunk);let offset=0;
          while(offset<buffer.length){controller.signal.throwIfAborted();const written=await file.write(buffer,offset,buffer.length-offset);if(!written.bytesWritten)throw new Error('文件写入未完成');offset+=written.bytesWritten;}
        }
        const expected=response.headers.get('content-length');
        if(!bytes||(expected!==null&&Number(expected)!==bytes))throw new Error('导出传输未完成，请重新保存');
        await file.sync();
      }finally{await file.close();}
      controller.signal.throwIfAborted();
      // No destination changes until the complete temporary file is synced.
      await rename(temporary,target);temporary='';
      const id=randomBytes(16).toString('hex');this.saved.set(id,target);
      while(this.saved.size>32)this.saved.delete(this.saved.keys().next().value!);
      return {id,path:target,bytes};
    }catch(error){if(controller.signal.aborted)return {cancelled:true} as const;throw error;}
    finally{controller.abort();if(response?.body&&!response.body.locked)await response.body.cancel().catch(()=>{});if(temporary)await unlink(temporary).catch(()=>{});this.active=null;}
  }
}
