type WindowPlaybackState = {purePlayback:boolean;alwaysOnTop:boolean;maximized:boolean;fullScreen:boolean};
interface Window {
  avhubDesktop?: {
    openRelease:(tag:string,format?:'folder'|'single')=>Promise<{ok:boolean}>;
    startupReady?:()=>Promise<{ok:boolean}>;
    dataLocation:(action:'get'|'choose')=>Promise<{current:string;default:string;next:string;locked:boolean}|{cancelled:true}>;
    chooseFolder:(purpose:'media'|'screenshots')=>Promise<{path:string}|{cancelled:true}>;
    appCommand:(command:'data-folder'|'project-page')=>Promise<{ok:boolean}>;
    screenshotAction:(id:string|null,action:'reveal'|'folder')=>Promise<{ok:boolean}>;
    mediaAction:(mediaId:number,action:'reveal'|'open')=>Promise<{ok:boolean}>;
    getWindowState: () => Promise<WindowPlaybackState>;
    setWindowMode: (value: {purePlayback?:boolean;alwaysOnTop?:boolean;videoAspectRatio?:number}) => Promise<WindowPlaybackState>;
    windowAction: (action:'minimize'|'maximize'|'close') => Promise<WindowPlaybackState|null>;
    onWindowStateChanged: (callback: (state:WindowPlaybackState) => void) => () => void;
  };
}
