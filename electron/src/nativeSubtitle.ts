export type SubtitleAppearance={size:number;color:string;background:number};
export const defaultSubtitleAppearance:SubtitleAppearance={size:30,color:'#ffffff',background:.65};
export function subtitleStyle(value:unknown):SubtitleAppearance {
  const v=value as SubtitleAppearance;
  if(!v||![22,26,30,34,38].includes(v.size)||!['#ffffff','#ffe38a','#9de7ff'].includes(v.color)||![0,.35,.65,.85].includes(v.background))throw new Error('字幕外观参数无效');
  return {size:v.size,color:v.color,background:v.background};
}
export function subtitleOptions(value:SubtitleAppearance):[string,string|number][] {
  return [['sub-font-size',value.size],['sub-color',value.color],['sub-back-color',`#${Math.round(value.background*255).toString(16).padStart(2,'0')}000000`],['sub-border-style','background-box']];
}
