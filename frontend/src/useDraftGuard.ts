import {useCallback,useEffect,useRef} from 'react';

export function useDraftGuard(dirty:boolean,busy:boolean,message:string){
  const latest=useRef({dirty,busy,message});latest.current={dirty,busy,message};
  const mayLeave=useCallback(()=>{const value=latest.current;return !value.busy&&(!value.dirty||window.confirm(value.message));},[]);
  useEffect(()=>{
    // Electron owns the single native retry/discard/cancel prompt during quit.
    // Do not show a renderer confirm first and then a second native prompt.
    const quit=(event:Event)=>{const value=latest.current;if(value.busy||value.dirty)(event as CustomEvent<Promise<unknown>[]>).detail.push(Promise.resolve(false));};
    window.addEventListener('avhub-before-quit',quit);return()=>window.removeEventListener('avhub-before-quit',quit);
  },[mayLeave]);
  return mayLeave;
}
