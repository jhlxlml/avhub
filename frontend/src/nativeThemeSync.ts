import type {NativeAppearance} from '../../electron/src/nativeTheme';

// Event driven, one request in flight and one latest desired value. Native
// state ticks must never become a stream of redundant appearance commands.
export class NativeThemeSync {
 private session:string|null=null;
 private desired:NativeAppearance|null=null;
 private attempted='';
 private running=false;
 private timer:ReturnType<typeof setTimeout>|undefined;
 private send:(session:string,appearance:NativeAppearance)=>Promise<unknown>;
 private failed:()=>void;
 constructor(send:(session:string,appearance:NativeAppearance)=>Promise<unknown>,failed:()=>void=()=>{}){this.send=send;this.failed=failed;}
 update(value:NativeAppearance){
  const {palette,accent,background,emphasis}=value;
  this.desired={palette,accent,background,emphasis};this.schedule();
 }
 setSession(session:string){if(session===this.session)return;this.session=session;this.schedule();}
 clearSession(session:string){if(this.session===session)this.session=null;}
 private schedule(){if(!this.running&&!this.timer)this.timer=setTimeout(()=>{this.timer=undefined;void this.flush();},0);}
 private async flush(){
  this.running=true;
  try{
   while(this.session&&this.desired){
    const session=this.session,value=this.desired,key=session+JSON.stringify(value);
    if(key===this.attempted)break;
    this.attempted=key;
    try{await this.send(session,value);}catch{if(session===this.session)this.failed();}
   }
  }finally{this.running=false;}
 }
}
