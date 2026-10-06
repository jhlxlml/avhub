// Outer portable extraction is measured by the acceptance runner before spawn.
export class StartupTrace {
  private started:number;
  private seen=new Set<string>();
  constructor(private write:(line:string)=>void,private now=()=>performance.now()) {this.started=now();}
  mark(stage:'begin'|'backend-start'|'backend-ready'|'window-created'|'renderer-loaded'|'library-ready') {
    if(this.seen.has(stage))return;
    if(stage==='begin')this.started=this.now();
    this.seen.add(stage);
    this.write(`startup-stage stage=${stage} elapsed_ms=${Math.round(this.now()-this.started)}`);
  }
}
