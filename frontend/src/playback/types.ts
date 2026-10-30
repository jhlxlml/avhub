export type EngineKind='html5'|'mpv';
export type EnginePreference='auto'|EngineKind;
export type MediaSource={mediaId:number;uri:string;transport:'direct'|'hls';offsetSec:number;durationSec?:number;resumePositionSec?:number;autoplay?:boolean};
export type PlaybackTarget=HTMLVideoElement|{nativeSurface:HTMLElement};
export type PlaybackError={code:string;message:string;recoverable:boolean};
export type PlaybackState={status:'idle'|'loading'|'ready'|'playing'|'paused'|'buffering'|'ended'|'error'|'destroyed';engine:EngineKind;generation:number;mediaId:number|null;positionSec:number;durationSec:number|null;bufferedRanges:ReadonlyArray<readonly[number,number]>;volume:number;muted:boolean;rate:number;videoSize?:{width:number;height:number};error?:PlaybackError};
export type Track={id:string;type:'audio'|'subtitle';language?:string;title?:string;external?:boolean;selected:boolean};
export type TrackPorts={list:()=>Track[];select:(type:Track['type'],id:string|null)=>Promise<void>|void;delay:(seconds:number)=>Promise<void>|void};
export interface PlaybackEngine {
 readonly kind:EngineKind;
 init(target:PlaybackTarget):Promise<void>;
 load(source:MediaSource,options?:{signal?:AbortSignal;generation?:number}):Promise<void>;
 play():Promise<void>;pause():Promise<void>;seekTo(seconds:number):Promise<void>;
 setVolume(value:number):Promise<void>;setMuted(value:boolean):Promise<void>;setRate(value:number):Promise<void>;
 listTracks(type?:Track['type']):Promise<Track[]>;selectTrack(type:Track['type'],id:string|null):Promise<void>;setSubtitleDelay(seconds:number):Promise<void>;
 getState():PlaybackState;subscribe(listener:(state:PlaybackState)=>void):()=>void;dispose():Promise<void>;
}
export const cancelled=()=>new DOMException('播放操作已取消','AbortError');
