import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './Icon';
import { changeAppearance, coverSizes, useAppearance } from './appearance';

export function ThemeToggle() {
  const {theme}=useAppearance();
  const label=theme==='dark'?'切换至浅色模式':'切换至深色模式';
  return <button className="ui-icon-button theme-toggle" aria-label={label} title={label}
    aria-pressed={theme==='light'} onClick={()=>changeAppearance({theme:theme==='dark'?'light':'dark'})}>
    <Icon name={theme==='dark'?'sun':'moon'}/>
  </button>;
}

export function CoverSizeControl({disabled=false}:{disabled?:boolean}) {
  const {coverSize}=useAppearance();
  const [open,setOpen]=useState(false);
  const ref=useRef<HTMLDivElement>(null);
  const button=useRef<HTMLButtonElement>(null);
  const id=useId();
  const index=coverSizes.findIndex(size=>size.id===coverSize);
  useEffect(()=>{if(disabled)setOpen(false);},[disabled]);
  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{if(!ref.current?.contains(event.target as Node))setOpen(false);};
    const escape=(event:KeyboardEvent)=>{
      if(event.key!=='Escape')return;
      event.preventDefault();event.stopPropagation();setOpen(false);button.current?.focus();
    };
    document.addEventListener('pointerdown',outside);
    document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[open]);
  return <div className="cover-size-control" ref={ref}>
    <button ref={button} className="ui-icon-button" aria-label="调整封面大小" aria-expanded={open&&!disabled}
      aria-controls={id} disabled={disabled} title={disabled?'切换到封面墙后调整大小':`封面大小：${coverSizes[index].label}`}
      onClick={()=>setOpen(value=>!value)}><Icon name="coverSize" size={18}/></button>
    {open&&!disabled&&<div id={id} className="cover-size-popover" role="group" aria-label="封面大小设置">
      <div className="cover-size-heading"><label htmlFor={`${id}-range`}>封面大小</label><output htmlFor={`${id}-range`}>{coverSizes[index].label}</output></div>
      <input id={`${id}-range`} aria-label="封面大小" aria-valuetext={coverSizes[index].label} type="range" min="0" max="3" step="1" value={index}
        onChange={event=>changeAppearance({coverSize:coverSizes[Number(event.target.value)].id})}/>
      <div className="cover-size-presets">{coverSizes.map(size=><button key={size.id} aria-pressed={size.id===coverSize}
        onClick={()=>changeAppearance({coverSize:size.id})}>{size.label}</button>)}</div>
      <small>仅调整封面墙布局，不改变每页数量和视频画质。</small>
    </div>}
  </div>;
}
