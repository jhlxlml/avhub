import {preference} from './preferences';
export function readMouseSeekSeconds() {
  const value=preference<unknown>('mouseSeekSeconds',5);
  return typeof value==='number'&&Number.isInteger(value)&&value>=1&&value<=120?value:5;
}
// Some drivers emit both an OS app-command and DOM mouse input for one press.
// Pair only cross-channel duplicates; repeated presses on one channel still work.
export function mouseSeekDeduper() {
  let previous:{source:'dom'|'native';direction:number;at:number}|null=null;
  return (source:'dom'|'native',direction:number,at=performance.now())=>{
    if(previous&&previous.source!==source&&previous.direction===direction&&at-previous.at>=0&&at-previous.at<80) {previous=null;return false;}
    previous={source,direction,at};return true;
  };
}
