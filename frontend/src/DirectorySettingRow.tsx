import {useId,useLayoutEffect,useRef,useState} from 'react';
import type {Root} from './api';
import type {FilePermission} from './FileManagement';
import {Icon} from './Icon';
import {IconButton} from './ui';

type Action='rename'|'recycle'|'permanentDelete';
const permissions:{action:Action;label:string;description:string}[]=[
  {action:'rename',label:'允许重命名',description:'修改真实文件名，并同步媒体库标题。'},
  {action:'recycle',label:'允许系统回收',description:'移入 Windows 回收站，或恢复到原目录。'},
  {action:'permanentDelete',label:'允许永久删除',description:'仅作用于回收记录中精确识别的项目；无法恢复，每次仍需确认。'},
];

export function DirectorySettingRow({root,value,offline,disabled,permission,scan,relocate,remove}:{
  root:Root;value?:FilePermission;offline:boolean;disabled:boolean;
  permission:(root:Root,action:Action,enabled:boolean)=>Promise<void>;
  scan:()=>void;relocate:()=>void;remove:()=>Promise<void>;
}) {
  const [expanded,setExpanded]=useState(false);
  const id=useId(),trigger=useRef<HTMLButtonElement>(null);
  const restoreAfterRemove=useRef(false);
  useLayoutEffect(()=>{
    if(disabled||!restoreAfterRemove.current)return;
    restoreAfterRemove.current=false;
    // Restore in the unlock commit, before the next user interaction. A queued
    // animation-frame callback can steal focus from an already chosen control.
    if(trigger.current?.isConnected&&!trigger.current.closest('[inert]'))trigger.current.focus({preventScroll:true});
  },[disabled]);
  const allowed=permissions.filter(item=>value?.[item.action]).map(item=>item.action==='rename'?'重命名':item.action==='recycle'?'系统回收':'永久删除');
  const summary=!value?'权限暂未读取':allowed.length?`已授权：${allowed.join('、')}`:'只读 · 未授权文件修改';
  return <div className="directory-setting-row">
    <div className="directory-setting-main">
      <span className="root-icon"><Icon name={offline?'warning':'folder'} size={18}/></span>
      <div className="root-info"><strong title={root.path}>{root.path.split(/[\\/]/).filter(Boolean).at(-1)||root.path}</strong><code title={root.path}>{root.path}</code></div>
      <div className="directory-setting-actions">
        {offline&&<button className="ui-button directory-relocate" disabled={disabled} onClick={relocate}><Icon name="reveal" size={14}/>重新定位</button>}
        <IconButton icon="refresh" label="扫描此目录" title={`扫描 ${root.path}`} disabled={disabled} onClick={scan}/>
        <button ref={trigger} type="button" className="ui-icon-button directory-remove" aria-label={`移出媒体库 ${root.path}`} title="移出媒体库（不删除原视频）" disabled={disabled} onClick={async()=>{restoreAfterRemove.current=true;await remove();}}><Icon name="close"/></button>
      </div>
    </div>
    <div className="directory-setting-meta"><span className={offline?'directory-offline':undefined}>{offline?'目录离线 · ':''}{summary}</span>
      <button className="directory-permission-toggle" aria-label={`文件权限 ${root.path}`} aria-expanded={expanded} aria-controls={id} onClick={()=>setExpanded(open=>!open)}><Icon name="shield" size={13}/>文件权限<Icon name={expanded?'chevronUp':'chevronDown'} size={12}/></button>
    </div>
    <div id={id} className="directory-permissions" hidden={!expanded}>
      <p>授权仅作用于此目录，更具体的子目录授权优先；不会修改视频内容。</p>
      <div className="file-permission-fields">{permissions.map(item=><label key={item.action} data-risk={item.action==='permanentDelete'?'destructive':undefined}>
        <span><b>{item.label}</b><small>{item.description}</small></span>
        <input className="settings-switch" type="checkbox" aria-label={`${item.label} ${root.path}`} checked={value?.[item.action]||false} disabled={disabled||!value?.supported||!window.avhubDesktop?.fileOperation} onChange={event=>void permission(root,item.action,event.target.checked)}/>
      </label>)}</div>
      {value?.reason&&<p className="directory-permission-reason">{value.reason}</p>}
    </div>
  </div>;
}
