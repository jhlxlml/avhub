// One observer for covers not yet admitted. Once near the viewport, release
// its watch before notifying React; keep the image itself until page unmount.
// Scrolling back must not cause repeated requests or decode churn.
type Watch={observer:IntersectionObserver;changed:(near:boolean)=>void;release:()=>void};
const listeners=new Map<Element,Watch>();
let observer:IntersectionObserver|null=null;
export function observeThumbnail(node:Element,changed:(near:boolean)=>void){
  if(typeof IntersectionObserver==='undefined'){changed(true);return()=>{};}
  listeners.get(node)?.release();
  if(!observer){
    const owner=new IntersectionObserver(entries=>{
      for(const entry of entries){
        const watch=listeners.get(entry.target);
        // Queued callbacks from an old observer cannot admit a replacement URL.
        if(!entry.isIntersecting||watch?.observer!==owner)continue;
        watch.release();watch.changed(true);
      }
    },{rootMargin:'320px 0px'});
    observer=owner;
  }
  const owner=observer;let released=false;
  const watch:Watch={observer:owner,changed,release:()=>{
    if(released)return;released=true;
    if(listeners.get(node)!==watch)return;
    listeners.delete(node);owner.unobserve(node);
    if(!listeners.size&&observer===owner){owner.disconnect();observer=null;}
  }};
  listeners.set(node,watch);owner.observe(node);
  return watch.release;
}
