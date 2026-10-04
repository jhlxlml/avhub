import { contextBridge, ipcRenderer } from 'electron';

ipcRenderer.on('avhub:quit-cancelled', () => window.dispatchEvent(new Event('avhub-quit-cancelled')));

contextBridge.exposeInMainWorld('avhubDesktop', {
  screenshotAction:(id:string|null,action:'reveal'|'folder')=>ipcRenderer.invoke('avhub:screenshot-action',id,action) as Promise<{ok:boolean}>,
  mediaAction:(mediaId:number,action:'reveal'|'open')=>ipcRenderer.invoke('avhub:media-action',mediaId,action) as Promise<{ok:boolean}>,
  getWindowState: () => ipcRenderer.invoke('avhub:window-state'),
  setWindowMode: (value: {purePlayback?:boolean;alwaysOnTop?:boolean;videoAspectRatio?:number}) => ipcRenderer.invoke('avhub:window-mode', value),
  windowAction: (action:'minimize'|'maximize'|'close') => ipcRenderer.invoke('avhub:window-action', action),
  onWindowStateChanged: (callback: (state: {purePlayback:boolean;alwaysOnTop:boolean;maximized:boolean;fullScreen:boolean}) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: {purePlayback:boolean;alwaysOnTop:boolean;maximized:boolean;fullScreen:boolean}) => callback(state);
    ipcRenderer.on('avhub:window-state-changed', listener);
    return () => ipcRenderer.removeListener('avhub:window-state-changed', listener);
  },
});
