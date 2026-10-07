import {type Root} from './api';
import {useLayoutEffect,useRef} from 'react';
import {Icon} from './Icon';
import {resolutionDisplayLabel,formatLabel} from './mediaLabels';
import './library-refinement.css';

export type LibraryConditions={q:string;root:string;folder:string;recursive:boolean;format:string;resolution:string;watch:'all'|'watched'|'unwatched';duration:''|'short'|'medium'|'long';season?:string};
export const clearedConditions:LibraryConditions={q:'',root:'',folder:'',recursive:true,format:'',resolution:'',watch:'all',duration:'',season:''};
export function LibraryFilters({value,roots,change,grouped=false}:{value:LibraryConditions;roots:Root[];change:(value:Partial<LibraryConditions>)=>void;grouped?:boolean}){
  const panel=useRef<HTMLDivElement>(null),focusIndex=useRef<number|null>(null);
  const conditions:{label:string;clear:Partial<LibraryConditions>}[]=[];
  if(value.q)conditions.push({label:`搜索：${value.q}`,clear:{q:''}});
  if(value.root){const path=roots.find(root=>String(root.id)===value.root)?.path||`目录 ${value.root}`;conditions.push({label:`目录：${path}`,clear:{root:'',folder:'',recursive:true}});}
  if(value.folder)conditions.push({label:`子目录：${value.folder}`,clear:{folder:''}});
  if(value.root&&!value.recursive)conditions.push({label:'仅当前目录',clear:{recursive:true}});
  if(value.format)conditions.push({label:`格式：${formatLabel(value.format)}`,clear:{format:''}});
  if(value.resolution)conditions.push({label:`分辨率：${resolutionDisplayLabel(value.resolution)}`,clear:{resolution:''}});
  if(value.watch!=='all')conditions.push({label:`观看：${value.watch==='watched'?'已看完':'未看完'}`,clear:{watch:'all'}});
  if(value.duration)conditions.push({label:`时长：${{short:'30 分钟内',medium:'30–90 分钟',long:'90 分钟以上'}[value.duration]}`,clear:{duration:''}});
  if(grouped&&value.season)conditions.push({label:`季：${value.season==='unknown'?'未设置':value.season==='0'?'特别篇':`第 ${value.season} 季`}`,clear:{season:''}});
  const identity=conditions.map(condition=>condition.label).join('\n');
  useLayoutEffect(()=>{
    if(focusIndex.current===null)return;
    if(document.activeElement===document.body){
      const buttons=panel.current?.querySelectorAll<HTMLButtonElement>('button');
      const target=buttons?.length?buttons[Math.min(focusIndex.current,buttons.length-1)]:document.querySelector<HTMLElement>('.series-heading select')||document.querySelector<HTMLElement>('.toolbar .sort-select,.toolbar select');
      target?.focus({preventScroll:true});
    }
    focusIndex.current=null;
  },[identity]);
  if(!conditions.length)return null;
  return <div ref={panel} className="library-filter-summary" role="region" aria-label="当前筛选条件">
    <span className="filter-summary-label">筛选 {conditions.length} 项</span>
    {conditions.map((condition,index)=><button key={condition.label} className="filter-chip" title={condition.label} aria-label={`移除筛选：${condition.label}`} onClick={()=>{focusIndex.current=index;change(condition.clear);}}><span>{condition.label}</span><Icon name="close" size={12}/></button>)}
    <button className="filter-summary-clear" onClick={()=>{focusIndex.current=0;change(clearedConditions);}}>清除全部筛选</button>
  </div>;
}
