import {preference} from './preferences';
export type ResumeBehavior='ask'|'resume'|'restart';
export function readResumeBehavior():ResumeBehavior {
  const value=preference<string>('resumeBehavior','ask');
  return value==='resume'||value==='restart'?value:'ask';
}
export function startingPoint(media:{progress:number;watched:boolean|number;duration:number},automatic:boolean,behavior:ResumeBehavior) {
  const progress=Number.isFinite(media.progress)&&media.progress>0?media.progress:0;
  const finished=Boolean(media.watched)||media.duration>0&&progress>=media.duration;
  if(finished||!progress||behavior==='restart')return {start:0,ask:false};
  return {start:progress,ask:!automatic&&behavior==='ask'};
}
