import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {Button,Dialog} from './ui';
import {Icon} from './Icon';

type Request={title:string;details:string;consequence:string;accept:string;danger:boolean;resolve:(accepted:boolean)=>void};
let pending:Request|null=null;
export function confirmInApp(title:string,details:string,consequence:string,accept='确认',danger=false):Promise<boolean>{
  if(pending)return Promise.resolve(false);
  return new Promise(resolve=>{
    pending={title,details,consequence,accept,danger,resolve};
    const event=new CustomEvent('avhub-confirm',{detail:pending});window.dispatchEvent(event);
    if(!document.querySelector('[data-app-confirm-host]')){pending=null;resolve(false);}
  });
}
export function AppConfirmHost(){
  const [request,setRequest]=useState<Request|null>(null);
  const [,setFullscreenRevision]=useState(0);
  useEffect(()=>{if(request)document.querySelector<HTMLButtonElement>('.app-confirm-dialog .close')?.focus({preventScroll:true});},[request]);
  useEffect(()=>{
    const receive=(event:Event)=>setRequest((event as CustomEvent<Request>).detail);
    const quit=(event:Event)=>{if(pending)(event as CustomEvent<Promise<unknown>[]>).detail.push(Promise.resolve(false));};
    window.addEventListener('avhub-confirm',receive);window.addEventListener('avhub-before-quit',quit);
    const fullscreen=()=>setFullscreenRevision(value=>value+1);document.addEventListener('fullscreenchange',fullscreen);
    return()=>{document.removeEventListener('fullscreenchange',fullscreen);window.removeEventListener('avhub-confirm',receive);window.removeEventListener('avhub-before-quit',quit);pending?.resolve(false);pending=null;};
  },[]);
  function finish(accepted:boolean){const value=pending;pending=null;setRequest(null);value?.resolve(accepted);}
  return <><span hidden data-app-confirm-host/>{request&&createPortal(<Dialog label={request.title} closeLabel="取消确认" busy={false} close={()=>finish(false)} className="modal app-confirm-dialog" backdropClassName="app-confirm-backdrop">
    <h2 className="dialog-title"><Icon name={request.danger?'warning':'shield'} size={22}/>{request.title}</h2>
    <p className="app-confirm-details">{request.details}</p><p className="dialog-description">{request.consequence}</p>
    <div className="tool-footer"><Button onClick={()=>finish(false)}>取消</Button><Button variant={request.danger?'danger':'primary'} onClick={()=>finish(true)}>{request.accept}</Button></div>
  </Dialog>,document.fullscreenElement||document.getElementById('root')||document.body)}</>;
}
