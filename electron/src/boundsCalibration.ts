import type {Rectangle} from 'electron';

const same=(a:Rectangle,b:Rectangle)=>a.x===b.x&&a.y===b.y&&a.width===b.width&&a.height===b.height;
const key=(b:Rectangle)=>[b.x,b.y,b.width,b.height].join(',');

// Windows can map adjacent integer-DIP requests to client sizes two DIP
// apart. Adding the whole read-back delta then oscillates instead of settling.
export class BoundsCalibration {
  private requested:Rectangle;
  private attempts=0;
  private finishing=false;
  private seen=new Set<string>();
  private best:{request:Rectangle;gap:number;distance:number}|undefined;
  constructor(private target:Rectangle,private ratio=0){
    this.requested={...target};this.seen.add(key(target));
  }
  observe(actual:Rectangle):Rectangle|null {
    if(this.finishing)return null;
    const delta={x:this.target.x-actual.x,y:this.target.y-actual.y,
      width:this.target.width-actual.width,height:this.target.height-actual.height};
    if(same(actual,this.target)||Object.values(delta).some(v=>Math.abs(v)>3))return null;
    if(this.ratio>0){
      const gap=Math.max(actual.width-actual.height*this.ratio,actual.height-actual.width/this.ratio,0)/2;
      const distance=Object.values(delta).reduce((a,b)=>a+Math.abs(b),0);
      if(!this.best||gap<this.best.gap-1e-6||Math.abs(gap-this.best.gap)<1e-6&&distance<this.best.distance)
        this.best={request:{...this.requested},gap,distance};
    }
    const next={x:this.requested.x+delta.x,y:this.requested.y+delta.y,
      width:this.requested.width+delta.width,height:this.requested.height+delta.height};
    if(this.attempts++>=3||this.ratio>0&&this.seen.has(key(next))){
      this.finishing=true;
      // Replay the best MEASURED request once, not a guessed extra correction.
      if(this.best&&!same(this.best.request,this.requested))return {...this.best.request};
      return null;
    }
    this.requested=next;this.seen.add(key(next));return {...next};
  }
}
