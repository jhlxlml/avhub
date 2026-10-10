import {useLayoutEffect,type RefObject} from 'react';

// Portal menus use viewport coordinates, never a card's clipping/containment box.
export function useAnchoredMenu(open:boolean,anchor:RefObject<HTMLElement|null>,panel:RefObject<HTMLElement|null>,close:()=>void) {
  useLayoutEffect(()=>{
    if(!open||!anchor.current||!panel.current)return;
    const button=anchor.current,menu=panel.current;let frame=0;
    const position=()=>{
      frame=0;
      if(!button.isConnected||!button.getClientRects().length){close();return;}
      const viewport=window.visualViewport,margin=8,gap=6;
      const left=(viewport?.offsetLeft??0)+margin,right=(viewport?.offsetLeft??0)+(viewport?.width??innerWidth)-margin;
      let top=(viewport?.offsetTop??0)+margin;
      const bottom=(viewport?.offsetTop??0)+(viewport?.height??innerHeight)-margin;
      const titlebar=document.querySelector<HTMLElement>('.desktop-titlebar');
      if(titlebar&&getComputedStyle(titlebar).opacity!=='0')top=Math.max(top,titlebar.getBoundingClientRect().bottom+margin);
      const rect=button.getBoundingClientRect();
      if(rect.bottom<=top||rect.top>=bottom||rect.right<=left||rect.left>=right){close();return;}
      const width=Math.max(1,Math.min(215,right-left));menu.style.width=`${width}px`;
      const natural=menu.scrollHeight+menu.offsetHeight-menu.clientHeight;
      const below=Math.max(0,bottom-rect.bottom-gap),above=Math.max(0,rect.top-gap-top);
      const upward=natural>below&&above>below,available=upward?above:below;
      const height=Math.min(natural,available);
      menu.style.maxHeight=`${available}px`;
      menu.style.left=`${Math.max(left,Math.min(rect.right-width,right-width))}px`;
      menu.style.top=`${Math.max(top,Math.min(upward?rect.top-gap-height:rect.bottom+gap,bottom-height))}px`;
      menu.style.visibility='visible';menu.dataset.placement=upward?'above':'below';
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(position);};
    const scroll=(event:Event)=>{if(!(event.target instanceof Node)||!menu.contains(event.target))schedule();};
    const fullscreen=()=>close();
    position();
    const observer=new ResizeObserver(schedule);observer.observe(button);observer.observe(menu);
    window.addEventListener('resize',schedule);document.addEventListener('scroll',scroll,true);
    document.addEventListener('fullscreenchange',fullscreen);
    viewportListeners(window.visualViewport,'addEventListener',schedule);
    return()=>{if(frame)cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('resize',schedule);document.removeEventListener('scroll',scroll,true);document.removeEventListener('fullscreenchange',fullscreen);viewportListeners(window.visualViewport,'removeEventListener',schedule);};
  },[open,anchor,panel,close]);
}
function viewportListeners(viewport:VisualViewport|null,method:'addEventListener'|'removeEventListener',listener:()=>void){viewport?.[method]('resize',listener);viewport?.[method]('scroll',listener);}
