import {useEffect,useState} from 'react';
import {api,type Root,type View} from './api';
import {Button,EmptyState} from './ui';
import {type IconName} from './Icon';

export function LibraryEmptyState({roots,root,view,icon,filtered,scanning,scanState,add,scan,clear}:{roots:Root[];root:string;view:View;icon:IconName;filtered:boolean;scanning:boolean;scanState?:string;add:()=>void;scan:()=>void;clear:()=>void}){
  const chosen=roots.find(value=>String(value.id)===root);
  const [availability,setAvailability]=useState<{id:number;available:boolean}|null>(null);
  useEffect(()=>{
    if(!chosen||chosen.available!==null)return;
    const controller=new AbortController();
    void api<Root[]>(`/api/roots/status?ids=${chosen.id}`,{signal:controller.signal}).then(values=>{if(!controller.signal.aborted&&values[0])setAvailability({id:values[0].id,available:values[0].available===true});}).catch(()=>{});
    return()=>controller.abort();
  },[chosen?.id,chosen?.available]);
  if(!roots.length)return <EmptyState icon="folder" title="添加文件夹，建立本地视频库" description="选择视频所在的文件夹，添加后开始扫描；原视频保持原位。"><Button icon="folder" onClick={add}>添加视频文件夹</Button></EmptyState>;
  if(chosen&&(chosen.available===false||chosen.available===null&&availability?.id===chosen.id&&!availability.available))return <EmptyState icon="warning" title="当前媒体目录离线" description="检查磁盘连接；盘符或位置改变时可在媒体目录设置中重新定位。"><Button icon="settings" onClick={add}>检查媒体目录</Button><Button onClick={clear}>查看全部视频</Button></EmptyState>;
  if(scanning)return <EmptyState icon="refresh" title="正在建立媒体库" description="索引结果会逐步出现，封面会在后台继续生成。"/>;
  if(filtered)return <EmptyState icon={icon} title="暂无匹配的视频" description="当前搜索、目录或筛选条件没有结果，可以清除条件后再查找。"><Button onClick={clear}>清除全部条件</Button></EmptyState>;
  const title=view==='continue'?'暂无可继续观看的视频':view==='favorites'?'暂无收藏视频':view==='history'?'暂无观看历史':view==='movies'?'暂无电影':view==='series'?'暂无剧集视频':scanState==='completed'?'尚未发现可用视频':'目录已添加，尚无视频索引';
  return <EmptyState icon={icon} title={title} description={view==='all'?'可扫描已添加目录；若仍无结果，请检查目录内容、连接和扫描结果。':'可以从全部视频开始浏览。'}>
    {view==='all'?<><Button icon="refresh" onClick={scan}>{root?'扫描当前目录':'开始扫描媒体库'}</Button><Button onClick={add}>检查媒体目录</Button></>:<Button onClick={clear}>查看全部视频</Button>}
  </EmptyState>;
}
