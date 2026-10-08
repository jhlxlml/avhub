import {useRef,useState} from 'react';
import {type Media,errorText} from './api';
import {requireDesktop} from './nativeDesktop';
import {Icon} from './Icon';

export function ExternalPlayerButton({media,notify}:{media:Media;notify:(message:string)=>void}) {
  const locked=useRef(false),[busy,setBusy]=useState(false);
  async function open() {
    if(locked.current||media.missing)return;
    locked.current=true;setBusy(true);
    try{await requireDesktop('mediaAction').mediaAction(media.id,'open');}
    catch(error){notify(errorText(error));}
    finally{locked.current=false;setBusy(false);}
  }
  return <button type="button" className="external-player-button" aria-label={`用系统播放器打开 ${media.title}`} title={media.missing?'文件离线，无法用系统播放器打开':'用系统播放器打开'}
    disabled={busy||Boolean(media.missing)} aria-busy={busy||undefined} onClick={()=>void open()}>
    <Icon name={busy?'refresh':'external'} size={15} className={busy?'is-spinning':undefined}/>
  </button>;
}
