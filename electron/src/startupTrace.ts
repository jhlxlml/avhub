// Outer portable extraction is measured by the acceptance runner before spawn.
export const rendererStartupStages=['renderer-starting','service-verified','preferences-ready','roots-ready','roots-error','startup-error','library-read-error'] as const;
type Stage='begin'|'backend-start'|'backend-ready'|'window-created'|'renderer-loaded'|'library-ready'|typeof rendererStartupStages[number];
export class StartupTrace {
  private started:number;
  private seen=new Set<string>();
  private last:Stage='begin';
  constructor(private write:(line:string)=>void,private now=()=>performance.now()) {this.started=now();}
  mark(stage:Stage) {
    if(this.seen.has(stage))return;
    if(stage==='begin')this.started=this.now();
    this.seen.add(stage);
    this.last=stage;
    this.write(`startup-stage stage=${stage} elapsed_ms=${Math.round(this.now()-this.started)}`);
  }
  snapshot(){return {last_stage:this.last,ready:this.seen.has('library-ready'),elapsed_ms:Math.round(this.now()-this.started)};}
}
