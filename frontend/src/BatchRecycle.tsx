import {useEffect,useRef,useState} from 'react';
import {desktopFile} from './FileManagement';
import {confirmInApp} from './AppConfirm';
import {useDraftGuard} from './useDraftGuard';
import {Button,Dialog,StatusMessage} from './ui';
import {Icon} from './Icon';
import {errorText} from './api';
import {fileSizeLabel} from './mediaLabels';

type Entry={id:number;title:string;path:string;size:number;eligible:boolean;reason:string;status:'pending'|'skipped'|'running'|'success'|'failed'|'stopped'};
const labels:Record<Entry['status'],string>={pending:'待回收',skipped:'跳过',running:'正在移入回收站',success:'已回收',failed:'失败',stopped:'未执行'};
export function BatchRecycle({ids,close,done}:{ids:number[];close:()=>void;done:(ids:number[])=>void}){
  const [phase,setPhase]=useState<'previewing'|'ready'|'confirming'|'running'|'finished'>('previewing');
  const [items,setItems]=useState<Entry[]>([]),[token,setToken]=useState(''),[error,setError]=useState('');
  const [stopRequested,setStopRequested]=useState(false);
  const stop=useRef(false),locked=useRef(false),active=useRef(true);
  const previewToken=useRef('');
  const busy=phase==='previewing'||phase==='confirming'||phase==='running';
  useDraftGuard(false,busy,'批量回收正在进行，请先停止后续任务并等待当前项完成');
  useEffect(()=>{
    active.current=true;
    void desktopFile({action:'preview',ids}).then(value=>{
      if(!active.current){if(value.preview_token)void desktopFile({action:'release-preview',previewToken:value.preview_token}).catch(()=>{});return;}
      if(!value.preview_token||!value.items)throw new Error('回收预览响应异常，请重启桌面组件');
      previewToken.current=value.preview_token;setToken(value.preview_token);setItems(value.items.map(item=>({...item,status:item.eligible?'pending':'skipped'})));setPhase('ready');
    }).catch(error=>{if(active.current){setError(errorText(error));setPhase('ready');}});
    return()=>{active.current=false;stop.current=true;if(previewToken.current)void desktopFile({action:'release-preview',previewToken:previewToken.current}).catch(()=>{});};
  },[ids]);
  const eligible=items.filter(item=>item.eligible),bytes=eligible.reduce((total,item)=>total+item.size,0);
  function update(id:number,status:Entry['status'],reason=''){if(active.current)setItems(items=>items.map(item=>item.id===id?{...item,status,reason}:item));}
  async function start(){
    if(locked.current||phase!=='ready'||!eligible.length)return;
    locked.current=true;setPhase('confirming');setError('');
    const confirmed=await confirmInApp(`确认回收 ${eligible.length} 个视频？`,`文件总大小约 ${fileSizeLabel(bytes)||'未知'}；跳过 ${items.length-eligible.length} 个不可操作项。`,
      '将逐项移入 Windows 系统回收站，不永久删除，也不修改视频内容。收藏、进度和片单保留。还原请使用系统回收站。','确认回收',true);
    if(!confirmed||!active.current){locked.current=false;if(active.current)setPhase('ready');return;}
    setPhase('running');const succeeded:number[]=[];
    try{
      for(const item of eligible){
        if(stop.current||!active.current){update(item.id,'stopped','已停止后续任务');continue;}
        update(item.id,'running');
        try{
          const result=await desktopFile({action:'recycle',id:item.id,previewToken:token});
          if(!result.ok)throw new Error('回收结果未确认，请核对操作记录');
          succeeded.push(item.id);update(item.id,'success');
        }catch(error){
          const message=errorText(error);update(item.id,'failed',message);
          if(/结果未能确认|结果未确认|操作尚未完成|服务响应异常|预览已失效/.test(message)){stop.current=true;if(active.current){setStopRequested(true);setError('操作结果不确定或预览已失效，已停止后续任务；请核对操作记录后重新预览。');}}
        }
      }
    }finally{locked.current=false;if(active.current){setPhase('finished');done(succeeded);}}
  }
  const count=(status:Entry['status'])=>items.filter(item=>item.status===status).length;
  return <Dialog label="批量移入系统回收站" closeLabel="关闭批量回收" busy={busy} close={close} className="modal library-tool-dialog">
    <h2 className="dialog-title"><Icon name="trash" size={22}/>批量移入系统回收站</h2>
    <p className="dialog-description">仅处理明确选中的 {ids.length} 个视频，逐项检查目录授权、文件身份和占用状态。不提供批量重命名或永久删除；进入回收站不等于立即释放磁盘空间。</p>
    {phase==='previewing'?<StatusMessage kind="loading">正在检查所选视频…</StatusMessage>:<>
      <p role="status">{phase==='finished'?`已回收 ${count('success')} · 失败 ${count('failed')} · 跳过 ${count('skipped')} · 未执行 ${count('stopped')}`:phase==='running'?`已处理 ${count('success')+count('failed')} / ${eligible.length} 个`:`可回收 ${eligible.length} 个 · 总大小 ${fileSizeLabel(bytes)||'未知'} · 跳过 ${count('skipped')} 个`}</p>
      <ol className="file-operation-list batch-recycle-list" aria-label="回收清单">{items.map(item=><li key={item.id}><div><strong>{labels[item.status]} · {item.title}</strong><code>{item.path}</code><small>{fileSizeLabel(item.size)||'大小未知'}{item.reason&&` · ${item.reason}`}</small></div></li>)}</ol>
      <p className="dialog-description">停止只影响未开始的项目，当前系统回收操作会完成。执行时再次验证预览快照；文件变化或授权撤销时拒绝回收。已开始系统回收的项目保存操作记录，执行前拒绝、跳过和未执行项仅显示在本次清单中。</p>
    </>}
    {error&&<StatusMessage kind="error">{error}</StatusMessage>}
    <div className="tool-footer">{phase==='running'?<Button disabled={stopRequested} onClick={()=>{stop.current=true;setStopRequested(true);}}>停止后续任务</Button>:<Button disabled={busy} onClick={close}>{phase==='finished'?'完成':'取消'}</Button>}
      {phase==='ready'&&<Button icon="trash" variant="danger" disabled={!eligible.length||!token} onClick={()=>void start()}>回收 {eligible.length} 个视频</Button>}
    </div>
  </Dialog>;
}
