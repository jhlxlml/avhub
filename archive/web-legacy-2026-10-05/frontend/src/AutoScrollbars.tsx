import { useEffect } from 'react';

const IDLE_MS=500;
const EDGE_PX=16;
const VISIBLE='data-scrollbar-visible';
type Activity={hovered:boolean;dragging:boolean;timer:number|null};

// Native scrollbars keep their gutter, hit testing and drag behaviour. Only
// their colour changes. Delegated events avoid per-card listeners or DOM scans.
export function AutoScrollbars() {
  useEffect(()=>{
    const active=new Map<HTMLElement,Activity>();
    let frame=0;
    let pointer:{x:number;y:number;path:HTMLElement[]}|null=null;
    const clearTimer=(state:Activity)=>{if(state.timer!==null)window.clearTimeout(state.timer);state.timer=null;};
    const remove=(element:HTMLElement,state:Activity)=>{
      clearTimer(state);element.removeAttribute(VISIBLE);active.delete(element);
    };
    const show=(element:HTMLElement)=>{
      let state=active.get(element);
      if(!state){state={hovered:false,dragging:false,timer:null};active.set(element,state);}
      clearTimer(state);
      if(!element.hasAttribute(VISIBLE))element.setAttribute(VISIBLE,'');
      return state;
    };
    const idle=(element:HTMLElement,state:Activity)=>{
      clearTimer(state);
      if(state.hovered||state.dragging)return;
      state.timer=window.setTimeout(()=>{if(active.get(element)===state)remove(element,state);},IDLE_MS);
    };
    const axes=(element:HTMLElement)=>{
      if(element.tagName==='SELECT'||!element.isConnected)return {x:false,y:false,rtl:false};
      const style=getComputedStyle(element);
      const root=element===document.scrollingElement;
      const allows=(value:string)=>root?!['hidden','clip'].includes(value):['auto','scroll','overlay'].includes(value);
      return {
        x:allows(style.overflowX)&&element.scrollWidth>element.clientWidth+1,
        y:allows(style.overflowY)&&element.scrollHeight>element.clientHeight+1,
        rtl:style.direction==='rtl',
      };
    };
    const updateHover=(next:Set<HTMLElement>)=>{
      for(const [element,state] of active)if(state.hovered&&!next.has(element)){
        state.hovered=false;idle(element,state);
      }
      for(const element of next){const state=show(element);state.hovered=true;}
    };
    const hitEdges=()=>{
      frame=0;if(!pointer)return;
      const next=new Set<HTMLElement>();
      const path=new Set(pointer.path);
      if(document.scrollingElement instanceof HTMLElement)path.add(document.scrollingElement);
      for(const element of path){
        const scroll=axes(element);if(!scroll.x&&!scroll.y)continue;
        const rect=element===document.scrollingElement
          ? {left:0,top:0,right:innerWidth,bottom:innerHeight}
          : element.getBoundingClientRect();
        const {x,y}=pointer;
        if(x<rect.left||x>rect.right||y<rect.top||y>rect.bottom)continue;
        if((scroll.y&&(scroll.rtl?x-rect.left:rect.right-x)<=EDGE_PX)||(scroll.x&&rect.bottom-y<=EDGE_PX))next.add(element);
      }
      updateHover(next);
    };
    const move=(event:PointerEvent)=>{
      if(event.pointerType!=='mouse')return;
      pointer={x:event.clientX,y:event.clientY,path:event.composedPath().filter((e):e is HTMLElement=>e instanceof HTMLElement)};
      if(!frame)frame=requestAnimationFrame(hitEdges);
    };
    const scroll=(event:Event)=>{
      const element=event.target===document?document.scrollingElement:event.target;
      if(!(element instanceof HTMLElement))return;
      const value=axes(element);if(!value.x&&!value.y)return;
      idle(element,show(element));
    };
    const down=(event:PointerEvent)=>{
      if(event.pointerType!=='mouse'||event.button!==0)return;
      // Resolve any pending mouse move before native thumb dragging starts.
      if(frame){cancelAnimationFrame(frame);hitEdges();}
      for(const state of active.values())if(state.hovered){state.dragging=true;clearTimer(state);}
    };
    const up=()=>{for(const [element,state] of active)if(state.dragging){state.dragging=false;idle(element,state);}};
    const leave=(event:PointerEvent)=>{
      if(event.relatedTarget!==null||event.clientX>=0&&event.clientX<innerWidth&&event.clientY>=0&&event.clientY<innerHeight)return;
      if(frame)cancelAnimationFrame(frame);frame=0;pointer=null;updateHover(new Set());
    };
    const blur=()=>{
      if(frame)cancelAnimationFrame(frame);frame=0;pointer=null;
      for(const [element,state] of active){state.hovered=false;state.dragging=false;idle(element,state);}
    };
    // A closed dialog must not leave a hovered, detached subtree retained.
    // This only inspects active bars, not every media card on each mutation.
    const observer=new MutationObserver(()=>{
      for(const [element,state] of active)if(!element.isConnected)remove(element,state);
      if(pointer?.path.some(element=>!element.isConnected))pointer.path=pointer.path.filter(element=>element.isConnected);
    });
    observer.observe(document.body,{childList:true,subtree:true});
    document.addEventListener('scroll',scroll,{capture:true,passive:true});
    window.addEventListener('pointermove',move,{passive:true});
    window.addEventListener('pointerdown',down,{capture:true,passive:true});
    window.addEventListener('pointerup',up,{capture:true,passive:true});
    window.addEventListener('pointercancel',up,{capture:true,passive:true});
    window.addEventListener('pointerout',leave,{passive:true});
    window.addEventListener('blur',blur);
    return()=>{
      observer.disconnect();if(frame)cancelAnimationFrame(frame);
      document.removeEventListener('scroll',scroll,true);
      window.removeEventListener('pointermove',move);window.removeEventListener('pointerdown',down,true);
      window.removeEventListener('pointerup',up,true);window.removeEventListener('pointercancel',up,true);
      window.removeEventListener('pointerout',leave);window.removeEventListener('blur',blur);
      for(const [element,state] of active)remove(element,state);
    };
  },[]);
  return null;
}
