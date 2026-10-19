// One observer for all covers. Keep a modest prefetch band rather than the
// browser's multi-screen lazy-image threshold. Page unmount releases images;
// moving admitted images offscreen must not cause repeated decode requests.
const listeners=new Map<Element,(near:boolean)=>void>();
let observer:IntersectionObserver|null=null;
export function observeThumbnail(node:Element,changed:(near:boolean)=>void){
  if(typeof IntersectionObserver==='undefined'){changed(true);return()=>{};}
  if(!observer)observer=new IntersectionObserver(entries=>{for(const entry of entries)listeners.get(entry.target)?.(entry.isIntersecting);},{rootMargin:'320px 0px'});
  listeners.set(node,changed);observer.observe(node);
  return()=>{listeners.delete(node);observer?.unobserve(node);if(!listeners.size){observer?.disconnect();observer=null;}};
}
