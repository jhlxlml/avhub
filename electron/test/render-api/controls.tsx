// Deliberately isolated React interaction fixture; not the production player UI.
import React,{useEffect,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
declare global {interface Window {renderSpike:{command:(action:string,value?:unknown)=>Promise<any>}}}
function Controls(){
 const [paused,setPaused]=useState(false),[menu,setMenu]=useState(false),[error,setError]=useState('');
 const [duration,setDuration]=useState(6);useEffect(()=>{let active=true;void window.renderSpike.command('source').then(c=>{if(active)setDuration(c.durationSec??6);}).catch(e=>{if(active)setError(String(e));});return()=>{active=false;};},[]);
 async function act(action:string,value?:unknown){try{await window.renderSpike.command(action,value);return true;}catch(e){setError(String(e));return false;}}
 const pauseQueue=useRef(Promise.resolve());
 function togglePause(){pauseQueue.current=pauseQueue.current.then(async()=>{try{const state=await window.renderSpike.command('snapshot'),next=state.pause!=='yes';if(await act('pause',next))setPaused(next);}catch(e){setError(String(e));}});return pauseQueue.current;}
 useEffect(()=>{const key=(event:KeyboardEvent)=>{
  if(event.defaultPrevented||event.repeat||event.ctrlKey||event.altKey||event.metaKey)return;
  const target=event.target as HTMLElement;
  if(target?.isContentEditable||target?.matches('textarea,input:not([type=range]),select'))return;
  if(menu){if(event.key==='Escape'){event.preventDefault();setMenu(false);}return;}
  if(event.code==='Space'){event.preventDefault();void togglePause();}
 };window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[menu]);
 return <div style={{position:'fixed',inset:0,pointerEvents:'none',fontFamily:'Segoe UI',color:'#fff'}}>
  <div style={{position:'absolute',left:24,top:24,textShadow:'0 1px 4px #000'}}>AVHub · libmpv Render API PoC</div>
  {menu&&<div role="menu" style={{position:'absolute',right:20,bottom:85,padding:24,background:'#20242ddd',borderRadius:12,pointerEvents:'auto'}}>React 设置弹层<button onClick={()=>setMenu(false)}>关闭菜单</button></div>}
  <div style={{position:'absolute',left:20,right:20,bottom:20,padding:16,background:'#10141ccc',borderRadius:12,display:'flex',gap:16,pointerEvents:'auto'}}>
   <button onClick={()=>void togglePause()}>{paused?'播放':'暂停'}</button>
   <input aria-label="跳播" type="range" min="0" max={duration} step="0.04" onChange={e=>void act('seek',Number(e.target.value))} style={{flex:1}}/>
   <button onClick={()=>setMenu(!menu)}>设置</button><button onClick={()=>void act('fullscreen')}>全屏</button>
   {error&&<span role="alert">{error}</span>}
  </div>
 </div>;
}
document.documentElement.style.background='transparent';document.body.style.margin='0';document.body.style.background='transparent';
createRoot(document.getElementById('root')!).render(<Controls/>);
