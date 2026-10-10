import {useCallback,useEffect,useRef} from 'react';
import {confirmInApp} from './AppConfirm';

export function useDraftGuard(dirty:boolean,busy:boolean,message:string){
  const latest=useRef({dirty,busy,message});latest.current={dirty,busy,message};
  const mayLeave=useCallback(async()=>{const value=latest.current;return !value.busy&&(!value.dirty||await confirmInApp('放弃未保存的修改？',value.message,'关闭后这些修改不会保存。','放弃修改',true));},[]);
  useEffect(()=>{
    // Electron owns the single native retry/discard/cancel prompt during quit.
    // Do not show a renderer confirm first and then a second native prompt.
    const quit=(event:Event)=>{const value=latest.current;if(value.busy||value.dirty)(event as CustomEvent<Promise<unknown>[]>).detail.push(Promise.resolve(false));};
    window.addEventListener('avhub-before-quit',quit);return()=>window.removeEventListener('avhub-before-quit',quit);
  },[mayLeave]);
  return mayLeave;
}
