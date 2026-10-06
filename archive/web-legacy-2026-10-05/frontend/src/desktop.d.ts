type WindowPlaybackState = {purePlayback:boolean;alwaysOnTop:boolean;maximized:boolean;fullScreen:boolean};
interface Window {
  avhubDesktop?: {
    screenshotAction:(id:string|null,action:'reveal'|'folder')=>Promise<{ok:boolean}>;
    mediaAction:(mediaId:number,action:'reveal'|'open')=>Promise<{ok:boolean}>;
    getWindowState: () => Promise<WindowPlaybackState>;
    setWindowMode: (value: {purePlayback?:boolean;alwaysOnTop?:boolean;videoAspectRatio?:number}) => Promise<WindowPlaybackState>;
    windowAction: (action:'minimize'|'maximize'|'close') => Promise<WindowPlaybackState|null>;
    onWindowStateChanged: (callback: (state:WindowPlaybackState) => void) => () => void;
  };
}
