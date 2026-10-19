export type MediaPlaybackState={source:string;audio:number|null;subtitle:string|null;delay:number};
type Track={id:number;type:string;external?:boolean;'ff-index'?:number;'external-filename'?:string};
export function nativeTrackChoice(tracks:Track[],kind:'audio'|'sub',choice:number|string|null){
  if(choice===null)return undefined;
  if(kind==='sub'&&choice==='')return 'no';
  const index=kind==='audio'?choice:typeof choice==='string'&&/^embedded:\d+$/.test(choice)?Number(choice.slice(9)):undefined;
  // Never mistake mpv's per-kind IDs for FFmpeg's absolute stream index.
  const match=tracks.find(t=>t.type===kind&&!t.external&&t['ff-index']===index);
  return match?.id;
}
export function rememberedTrack(tracks:Track[],kind:'audio'|'sub',id:number|string):number|string|undefined{
  if(kind==='sub'&&id==='no')return '';
  const track=tracks.find(t=>t.type===kind&&t.id===id);
  if(!track||track.external||!Number.isInteger(track['ff-index']))return undefined;
  return kind==='audio'?track['ff-index']:`embedded:${track['ff-index']}`;
}
