/** Own one Windows multimedia timer request, never a system-wide setting. */
export function playbackClock(begin:(period:number)=>number,end:(period:number)=>number){
 let active=false,available=true,requests=0,releases=0,lastResult:number|null=null;
 return {
  setActive(playing:boolean){
   if(playing===active||playing&&!available)return;
   lastResult=playing?begin(1):end(1);
   if(lastResult===0){active=playing;if(playing)requests++;else releases++;}
   else if(playing)available=false;
  },
  snapshot:()=>({active,available,requests,releases,lastResult}),
 };
}
