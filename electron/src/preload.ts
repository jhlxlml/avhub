import { contextBridge, ipcRenderer } from 'electron';

ipcRenderer.on('avhub:quit-cancelled', () => window.dispatchEvent(new Event('avhub-quit-cancelled')));

contextBridge.exposeInMainWorld('avhubDesktop', {
  nativePlayer:(action:string,input?:unknown)=>ipcRenderer.invoke('avhub:native-player',action,input),
    onNativeShortcut:(callback:(value:{code:string;shiftKey:boolean;repeat:boolean})=>void)=>{
      const listener=(_event:Electron.IpcRendererEvent,value:{code:string;shiftKey:boolean;repeat:boolean})=>callback(value);
      ipcRenderer.on('avhub:native-shortcut',listener);return()=>ipcRenderer.removeListener('avhub:native-shortcut',listener);
    },
  onNativeState:(callback:(value:unknown)=>void)=>{
    const listener=(_event:Electron.IpcRendererEvent,value:unknown)=>callback(value);
    ipcRenderer.on('avhub:native-state',listener);return()=>ipcRenderer.removeListener('avhub:native-state',listener);
  },
  onNativeEvent:(callback:(value:unknown)=>void)=>{
    const listener=(_event:Electron.IpcRendererEvent,value:unknown)=>callback(value);
    ipcRenderer.on('avhub:native-event',listener);return()=>ipcRenderer.removeListener('avhub:native-event',listener);
  },
  onNativeClosed:(callback:(value:unknown)=>void)=>{
    const listener=(_event:Electron.IpcRendererEvent,value:unknown)=>callback(value);
    ipcRenderer.on('avhub:native-closed',listener);return()=>ipcRenderer.removeListener('avhub:native-closed',listener);
  },
  saveExport:(request:{kind:'backup';jobId:string}|{kind:'diagnostics'|'playback-diagnostics'})=>ipcRenderer.invoke('avhub:save-export',request),
  cancelExport:()=>ipcRenderer.invoke('avhub:cancel-export'),
  revealExport:(id:string)=>ipcRenderer.invoke('avhub:reveal-export',id),
  openRelease:(tag:string,format?:'folder'|'single')=>ipcRenderer.invoke('avhub:open-release',tag,format),
  startupReady:()=>ipcRenderer.invoke('avhub:startup-ready'),
  onMouseSeek:(callback:(direction:'back'|'forward')=>void)=>{
    const listener=(_event:Electron.IpcRendererEvent,direction:unknown)=>{if(direction==='back'||direction==='forward')callback(direction);};
    ipcRenderer.on('avhub:mouse-seek',listener);return()=>{ipcRenderer.removeListener('avhub:mouse-seek',listener);};
  },
  dataLocation:(action:'get'|'choose')=>ipcRenderer.invoke('avhub:data-location',action),
  chooseFolder:(purpose:'media'|'screenshots')=>ipcRenderer.invoke('avhub:choose-folder',purpose) as Promise<{path:string}|{cancelled:true}>,
  appCommand:(command:'data-folder'|'project-page')=>ipcRenderer.invoke('avhub:app-command',command) as Promise<{ok:boolean}>,
  screenshotAction:(id:string|null,action:'reveal'|'folder')=>ipcRenderer.invoke('avhub:screenshot-action',id,action) as Promise<{ok:boolean}>,
  mediaAction:(mediaId:number,action:'reveal'|'open')=>ipcRenderer.invoke('avhub:media-action',mediaId,action) as Promise<{ok:boolean}>,
  fileOperation:(value:{action:'rename'|'recycle'|'permissions'|'recycle-bin'|'recheck'|'forget'|'preview'|'release-preview'|'restore-record'|'delete-record'|'clear-record'|'preview-records'|'release-record-preview'|'recheck-record'|'resolve-source';id?:number|string;ids?:number[];recordIds?:string[];recordAction?:'restore'|'delete'|'clear';previewToken?:string;stem?:string;rename?:boolean;recycle?:boolean;permanentDelete?:boolean;decision?:'keep'|'reset';signature?:string;confirmed?:boolean})=>ipcRenderer.invoke('avhub:file-operation',value),
  getWindowState: () => ipcRenderer.invoke('avhub:window-state'),
  setWindowMode: (value: {purePlayback?:boolean;alwaysOnTop?:boolean;videoAspectRatio?:number}) => ipcRenderer.invoke('avhub:window-mode', value),
  windowAction: (action:'minimize'|'maximize'|'close') => ipcRenderer.invoke('avhub:window-action', action),
  onWindowStateChanged: (callback: (state: {purePlayback:boolean;alwaysOnTop:boolean;maximized:boolean;fullScreen:boolean}) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: {purePlayback:boolean;alwaysOnTop:boolean;maximized:boolean;fullScreen:boolean}) => callback(state);
    ipcRenderer.on('avhub:window-state-changed', listener);
    return () => ipcRenderer.removeListener('avhub:window-state-changed', listener);
  },
});
