import {useState} from 'react';
import {type Media,type MediaUpdate} from './api';
import {MediaEditor} from './MediaEditor';
import {Dialog,Button} from './ui';
import {Icon} from './Icon';
import {useDraftGuard} from './useDraftGuard';

export function MediaEditDialog({media,update,close}:{media:Media;update:(value:MediaUpdate)=>void;close:()=>void}){
  const [dirty,setDirty]=useState(false),[busy,setBusy]=useState(false);
  const mayLeave=useDraftGuard(dirty,busy,'媒体信息尚未保存，放弃更改并关闭吗？');
  const requestClose=async()=>{if(await mayLeave())close();};
  return <Dialog label="编辑媒体信息与封面" closeLabel="关闭媒体编辑" busy={busy} close={requestClose} className="modal library-tool-dialog">
    <h2 className="dialog-title"><Icon name="edit" size={22}/>编辑媒体信息与封面</h2>
    <p className="dialog-description">{media.title} · {media.missing?'源文件离线，仍可修改信息和导入封面':'仅修改媒体库信息，不改动原视频'}</p>
    <MediaEditor media={media} update={update} onDirtyChange={setDirty} onBusyChange={setBusy} expanded/>
    <div className="tool-footer">{dirty&&<span role="status">媒体信息尚未保存</span>}<Button disabled={busy} onClick={requestClose}>完成</Button></div>
  </Dialog>;
}
