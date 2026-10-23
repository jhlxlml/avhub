import {useEffect,useState,type ComponentProps} from 'react';
import {errorText} from './api';
import {Dialog,StatusMessage} from './ui';

type Screen=typeof import('./Settings').Settings;
type Props=ComponentProps<Screen>;
let loaded:Screen|null=null;

// A failed optional module must not unmount the library or its save/quit hosts.
export function DeferredSettings(props:Props){
 const [Screen,setScreen]=useState<Screen|null>(()=>loaded);
 const [error,setError]=useState('');
 useEffect(()=>{
  if(Screen)return;
  let active=true;setError('');
  void import('./Settings').then(module=>{
   loaded=module.Settings;if(active)setScreen(()=>module.Settings);
  }).catch(reason=>{if(active)setError(errorText(reason));});
  return()=>{active=false;};
 },[Screen]);
 if(Screen)return <Screen {...props}/>;
 return <Dialog label="媒体库设置" closeLabel="关闭设置" busy={false} close={props.close}>
  <StatusMessage kind={error?'error':'loading'}>{error?`设置界面加载失败：${error}`:'正在打开设置…'}</StatusMessage>
  {error&&<p>请关闭设置，完全退出并重新打开 AVHub 后再试；媒体库仍可使用。</p>}
 </Dialog>;
}
