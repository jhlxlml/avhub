/** One in-flight layout, latest desired geometry, bounded transient retries. */
export class NativeLayoutQueue<T>{
  private wanted:{key:string;value:T}|null=null;
  private applied='';private running=false;private disposed=false;private attempts=0;
  private retry:ReturnType<typeof setTimeout>|undefined;
  constructor(private write:(value:T)=>Promise<unknown>,private failed:(error:unknown)=>void){}
  push(value:T,key:string){
    if(this.disposed||key===this.wanted?.key||!this.wanted&&key===this.applied)return;
    this.wanted={value,key};this.attempts=0;clearTimeout(this.retry);this.retry=undefined;void this.drain();
  }
  private async drain(){
    if(this.running||this.disposed)return;this.running=true;
    try{while(this.wanted&&!this.disposed){
      const job=this.wanted;
      try{await this.write(job.value);this.applied=job.key;this.attempts=0;if(this.wanted===job)this.wanted=null;}
      catch(error){
        if(this.disposed)return;if(this.wanted!==job)continue;
        if(++this.attempts<=3){this.retry=setTimeout(()=>{this.retry=undefined;void this.drain();},100*this.attempts);return;}
        this.wanted=null;this.failed(error);return;
      }
    }}finally{this.running=false;}
  }
  dispose(){this.disposed=true;this.wanted=null;clearTimeout(this.retry);}
}
