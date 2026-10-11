type WindowPlaybackState = {purePlayback:boolean;alwaysOnTop:boolean;maximized:boolean;fullScreen:boolean};
type DesktopRecordPreview={id:string;eligible:boolean;reason:string;action:'restore'|'delete'|'clear';name?:string;source?:string;size?:number};
interface Window {
  avhubDesktop?: {
    saveExport:(request:{kind:'backup';jobId:string}|{kind:'diagnostics'})=>Promise<{cancelled:true}|{id:string;path:string;bytes:number}>;
    cancelExport:()=>Promise<{ok:boolean}>;
    revealExport:(id:string)=>Promise<{ok:boolean}>;
    openRelease:(tag:string,format?:'folder'|'single')=>Promise<{ok:boolean}>;
    startupReady?:()=>Promise<{ok:boolean}>;
    onMouseSeek?:(callback:(direction:'back'|'forward')=>void)=>()=>void;
    dataLocation:(action:'get'|'choose')=>Promise<{current:string;default:string;next:string;locked:boolean}|{cancelled:true}>;
    chooseFolder:(purpose:'media'|'screenshots')=>Promise<{path:string}|{cancelled:true}>;
    appCommand:(command:'data-folder'|'project-page')=>Promise<{ok:boolean}>;
    screenshotAction:(id:string|null,action:'reveal'|'folder')=>Promise<{ok:boolean}>;
    mediaAction:(mediaId:number,action:'reveal'|'open')=>Promise<{ok:boolean}>;
    fileOperation?:(value:{action:'rename'|'recycle'|'permissions'|'recycle-bin'|'recheck'|'forget'|'preview'|'release-preview'|'restore-record'|'delete-record'|'clear-record'|'preview-records'|'release-record-preview'|'recheck-record'|'resolve-source';id?:number|string;ids?:number[];recordIds?:string[];recordAction?:'restore'|'delete'|'clear';previewToken?:string;stem?:string;rename?:boolean;recycle?:boolean;permanentDelete?:boolean;decision?:'keep'|'reset';signature?:string;confirmed?:boolean})=>Promise<{ok?:boolean;media_id?:number;operation_id?:string;restored?:boolean;message?:string;preview_token?:string;expires_in?:number;records?:DesktopRecordPreview[];items?:{id:number;title:string;path:string;size:number;eligible:boolean;reason:string}[]}>;
    getWindowState: () => Promise<WindowPlaybackState>;
    setWindowMode: (value: {purePlayback?:boolean;alwaysOnTop?:boolean;videoAspectRatio?:number}) => Promise<WindowPlaybackState>;
    windowAction: (action:'minimize'|'maximize'|'close') => Promise<WindowPlaybackState|null>;
    onWindowStateChanged: (callback: (state:WindowPlaybackState) => void) => () => void;
  };
}
