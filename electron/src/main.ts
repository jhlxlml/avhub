import { app, BrowserWindow, dialog, ipcMain, Menu, screen, shell, type IpcMainInvokeEvent, type Rectangle } from 'electron';
import {textEditTemplate} from './textEditMenu';
import { fitPlaybackBounds, playbackMinimum } from './playbackGeometry';
import { loadDesktopIcon } from './appIcon';
import { permissionAllowed } from './permissionPolicy';
import {StartupTrace} from './startupTrace';
import {LocalExports} from './localExports';
import { stopOwnedBackend } from './backendShutdown';
import { appendBoundedLog } from './desktopLogs';
import { previousDirectory,rememberDirectory,type DirectoryPurpose } from './directoryHistory';
import {configName,readDataLocation,writeDataLocation,writableDirectory,migrationConfig,type DataMigration} from './dataLocation';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { realpath,stat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash, randomBytes } from 'node:crypto';

const isPackaged = app.isPackaged;
const projectRoot = app.getAppPath();
let backend: ChildProcess | null = null;
let applicationStarted = false;
let backendPort = 0;
let sessionToken = '';
let mainWindow: BrowserWindow | null = null;
let shuttingDown = false;
let allowQuit = false;
let backendExitCode: number | null | undefined;
let dataDir = '';
let startupError: Error | null = null;
let purePlayback = false;
let normalPlaybackWindow: { contentBounds: Rectangle; maximized: boolean } | null = null;
let playbackAspectRatio=0;
let expandedPlaybackBounds:Rectangle|null=null;
let fittingPlaybackWindow=false;
const startupTrace=new StartupTrace(line=>appendDesktopLog(line));
const dataHome=isPackaged?(process.env.PORTABLE_EXECUTABLE_DIR||path.dirname(app.getPath('exe'))):(process.env.AVHUB_APP_HOME||projectRoot);
const dataConfigFile=path.join(dataHome,configName);
const defaultDataDir=path.join(dataHome,'AVHub-data');
let pendingDataMigration:DataMigration|undefined;

function setExactContentBounds(window:BrowserWindow,target:Rectangle) {
  window.setContentBounds(target);
  // Correct fractional-DPI client rounding once, using measured differences.
  const actual=window.getContentBounds();
  const dw=actual.width-target.width,dh=actual.height-target.height;
  if((dw || dh) && Math.abs(dw)<=2 && Math.abs(dh)<=2)
    window.setContentBounds({...target,width:target.width-dw,height:target.height-dh});
}
function fitPlaybackWindow(window:BrowserWindow,largest=expandedPlaybackBounds!==null) {
  if(!purePlayback || !playbackAspectRatio || window.isFullScreen() || window.isMinimized() || fittingPlaybackWindow)return;
  fittingPlaybackWindow=true;
  try {
    const current=window.getContentBounds(),outer=window.getBounds();
    const area=screen.getDisplayMatching(outer).workArea;
    // Account for native invisible resize borders; controls overlay the video.
    const work={x:area.x+current.x-outer.x,y:area.y+current.y-outer.y,
      width:area.width-(outer.width-current.width),height:area.height-(outer.height-current.height)};
    if(window.isMaximized())window.unmaximize();
    window.setMinimumSize(...playbackMinimum(playbackAspectRatio,work));
    window.setAspectRatio(playbackAspectRatio);
    setExactContentBounds(window,fitPlaybackBounds(current,work,playbackAspectRatio,largest));
    // At fractional DPI the nearest realizable height can differ by one DIP.
    // Fit width to the *measured* height, rather than repeatedly requesting the
    // same rounded rectangle. Bound attempts to avoid resize feedback loops.
    for(let i=0;i<2;i++) {
      const measured=window.getContentBounds();
      if(Math.abs(measured.width-measured.height*playbackAspectRatio)<=Math.max(1,playbackAspectRatio/2))break;
      const width=Math.min(work.width,Math.round(measured.height*playbackAspectRatio));
      const height=width===work.width?Math.round(width/playbackAspectRatio):measured.height;
      const x=Math.max(work.x,Math.min(work.x+work.width-width,Math.round(measured.x+(measured.width-width)/2)));
      setExactContentBounds(window,{...measured,x,width,height});
    }
  } finally {fittingPlaybackWindow=false;}
}
function togglePlaybackExpand(window:BrowserWindow) {
  if(expandedPlaybackBounds) {
    const restore=expandedPlaybackBounds;expandedPlaybackBounds=null;
    setExactContentBounds(window,restore);fitPlaybackWindow(window,false);
  } else {
    expandedPlaybackBounds=window.getContentBounds();fitPlaybackWindow(window,true);
  }
  publishWindowState(window);
}

function trustedWindow(event: IpcMainInvokeEvent): BrowserWindow {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window !== mainWindow || event.senderFrame !== event.sender.mainFrame ||
      new URL(event.senderFrame.url).origin !== `http://127.0.0.1:${backendPort}`) throw new Error('窗口操作来源无效');
  return window;
}
const localExports=new LocalExports(()=>dataDir,async(request,signal)=>{
  const origin=`http://127.0.0.1:${backendPort}`;
  const options={headers:{'X-AVHub-Token':sessionToken},signal,redirect:'error' as const};
  if(request.kind==='diagnostics'){
    const result=await fetch(`${origin}/api/diagnostics`,options);
    if(!result.ok)throw new Error('读取诊断失败，请刷新后重试');
    const body=JSON.stringify(await result.json(),null,2);
    return {filename:'avhub-diagnostics.json',response:new Response(body),maximum:16*1024*1024};
  }
  const status=await fetch(`${origin}/api/data-jobs/${request.jobId}`,options);
  if(!status.ok)throw new Error('备份任务已过期，请重新生成');
  const job=await status.json() as {kind:string;state:string;result?:{filename?:string}};
  if(job.kind!=='backup'||job.state!=='ready'||!job.result?.filename)throw new Error('备份尚未完成');
  return {filename:job.result.filename,response:await fetch(`${origin}/api/data-jobs/${request.jobId}/download`,options),maximum:2*1024**3};
});
ipcMain.handle('avhub:save-export',(event,value:unknown)=>localExports.save(trustedWindow(event),value));
ipcMain.handle('avhub:cancel-export',event=>{trustedWindow(event);return localExports.cancel();});
ipcMain.handle('avhub:reveal-export',(event,id:unknown)=>{trustedWindow(event);return localExports.reveal(id);});
function windowState(window: BrowserWindow) {
  return { purePlayback, alwaysOnTop: window.isAlwaysOnTop(), maximized: window.isMaximized() || expandedPlaybackBounds!==null, fullScreen: window.isFullScreen() };
}
function publishWindowState(window: BrowserWindow) {
  if (!window.isDestroyed()) window.webContents.send('avhub:window-state-changed', windowState(window));
}
ipcMain.handle('avhub:window-state', event => windowState(trustedWindow(event)));
ipcMain.handle('avhub:startup-ready',event=>{trustedWindow(event);startupTrace.mark('library-ready');return {ok:true};});
ipcMain.handle('avhub:window-mode', (event, value: unknown) => {
  const window = trustedWindow(event);
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.entries(value).some(([key, flag]) => key==='videoAspectRatio'
        ? typeof flag!=='number' || !Number.isFinite(flag) || flag<1/64 || flag>64
        : !['purePlayback', 'alwaysOnTop'].includes(key) || typeof flag !== 'boolean'))
    throw new Error('窗口模式参数无效');
  const update = value as {purePlayback?: boolean; alwaysOnTop?: boolean;videoAspectRatio?:number};
  let needsFit=false;
  const pureTransition=update.purePlayback!==undefined && update.purePlayback!==purePlayback;
  if (update.purePlayback !== undefined && update.purePlayback !== purePlayback) {
    if (update.purePlayback) {
      const maximized=window.isMaximized();
      // Windows maximized/normal invisible frame insets differ. Restore first
      // and measure the real client bounds rather than inferring an offset.
      if(maximized)window.unmaximize();
      normalPlaybackWindow = { contentBounds:window.getContentBounds(),maximized };
      if(maximized)expandedPlaybackBounds=window.getContentBounds();
      window.setMinimumSize(270,180);
      purePlayback = true;
      needsFit=true;
    } else {
      purePlayback = false;
      playbackAspectRatio=0;expandedPlaybackBounds=null;
      window.setAspectRatio(0);
      window.setMinimumSize(760, 560);
      if (normalPlaybackWindow) {
        if (window.isMaximized()) window.unmaximize();
        setExactContentBounds(window,normalPlaybackWindow.contentBounds);
        if(normalPlaybackWindow.maximized)window.maximize();
      }
      normalPlaybackWindow = null;
    }
  }
  if(purePlayback && update.videoAspectRatio!==undefined && Math.abs(update.videoAspectRatio-playbackAspectRatio)>1e-6) {
    playbackAspectRatio=update.videoAspectRatio;needsFit=true;
  }
  if(needsFit)fitPlaybackWindow(window);
  // Enter/exit owns this transition, even if a combined IPC request conflicts.
  // Manual pin toggles remain available while staying in the same mode; ratio
  // updates and video switches must not undo a deliberate manual unpin.
  if(pureTransition)window.setAlwaysOnTop(purePlayback);
  else if (update.alwaysOnTop !== undefined) window.setAlwaysOnTop(update.alwaysOnTop);
  publishWindowState(window);
  return windowState(window);
});
ipcMain.handle('avhub:window-action', (event, action: unknown) => {
  const window = trustedWindow(event);
  if (action === 'minimize') window.minimize();
  else if (action === 'maximize') {
    if(purePlayback && playbackAspectRatio)togglePlaybackExpand(window);
    else if (window.isMaximized()) window.unmaximize(); else window.maximize();
  }
  else if (action === 'close') window.close();
  else throw new Error('窗口操作参数无效');
  return window.isDestroyed() ? null : windowState(window);
});

ipcMain.handle('avhub:media-action',async(event,mediaId:unknown,action:unknown)=>{
  const origin=`http://127.0.0.1:${backendPort}`;
  if(event.senderFrame!==event.sender.mainFrame || new URL(event.senderFrame.url).origin!==origin)
    throw new Error('文件操作来源无效');
  if(typeof mediaId!=='number' || !Number.isSafeInteger(mediaId) || mediaId<=0 || !['reveal','open'].includes(String(action)))
    throw new Error('文件操作参数无效');
  const response=await fetch(`${origin}/api/media/${mediaId}/native-path`,{headers:{'X-AVHub-Token':sessionToken},signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error('视频索引不存在');
  const item=await response.json() as {path?:string;missing?:boolean};
  if(!item.path || item.missing)throw new Error('视频文件已离线');
  // Renderer submits only an indexed ID, never a command or arbitrary path.
  const source=await realpath(item.path);
  const extensions=new Set(['.mp4','.mkv','.avi','.mov','.m4v','.webm','.wmv','.flv','.ts','.mts','.m2ts']);
  if(!extensions.has(path.extname(source).toLowerCase()) || !(await stat(source)).isFile())throw new Error('不是受支持的视频文件');
  if(action==='reveal')shell.showItemInFolder(source);
  else {const error=await shell.openPath(source);if(error)throw new Error('无法打开系统播放器，请检查默认视频应用');}
  return {ok:true};
});

ipcMain.handle('avhub:screenshot-action',async(event,id:unknown,action:unknown)=>{
  trustedWindow(event);
  if(!((action==='reveal'&&typeof id==='string'&&/^[a-f0-9]{32}$/.test(id))||(action==='folder'&&id===null)))throw new Error('截图操作参数无效');
  const origin=`http://127.0.0.1:${backendPort}`;
  // Never accept renderer-supplied paths. Only the service-confirmed capture or configured directory.
  const response=await fetch(`${origin}/api/screenshots/${action==='folder'?'directory':id}`,{headers:{'X-AVHub-Token':sessionToken},signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error('截图或保存目录不可访问，请检查磁盘或截图设置');
  const result=await response.json() as {path?:string};
  if(!result.path)throw new Error('截图路径无效');
  const source=await realpath(result.path);const info=await stat(source);
  if(action==='reveal') {
    if(path.extname(source).toLowerCase()!=='.png'||!info.isFile())throw new Error('截图文件不可访问');
    shell.showItemInFolder(source);
  } else {
    if(!info.isDirectory())throw new Error('截图目录不可访问');
    const error=await shell.openPath(source);if(error)throw new Error('无法打开截图目录');
  }
  return {ok:true};
});

let directoryDialogActive=false;
ipcMain.handle('avhub:choose-folder',async(event,purpose:unknown)=>{
  const owner=trustedWindow(event);
  if(purpose!=='media'&&purpose!=='screenshots')throw new Error('目录用途无效');
  if(directoryDialogActive)throw new Error('请先完成当前目录选择');
  directoryDialogActive=true;
  try {
    const kind=purpose as DirectoryPurpose;
    const previous=await previousDirectory(dataDir,kind);
    const result=await dialog.showOpenDialog(owner,{
      title:kind==='media'?'选择媒体目录':'选择截图保存目录',properties:['openDirectory'],
      ...(previous?{defaultPath:previous}:{}),
    });
    if(result.canceled||result.filePaths.length===0)return {cancelled:true};
    const selected=await realpath(result.filePaths[0]);
    if(!(await stat(selected)).isDirectory())throw new Error('所选目录已离线或不可访问');
    await rememberDirectory(dataDir,kind,selected);return {path:selected};
  }finally{directoryDialogActive=false;}
});
ipcMain.handle('avhub:app-command',async(event,command:unknown)=>{
  trustedWindow(event);
  if(command==='project-page') {
    await shell.openExternal('https://github.com/jhlxlml/avhub');return {ok:true};
  }
  if(command!=='data-folder')throw new Error('应用操作无效');
  const directory=await realpath(dataDir);
  if(!(await stat(directory)).isDirectory())throw new Error('数据目录不可访问');
  const error=await shell.openPath(directory);if(error)throw new Error('无法打开数据目录');
  return {ok:true};
});
ipcMain.handle('avhub:open-release',async(event,tag:unknown,format:unknown)=>{
  trustedWindow(event);
  if(typeof tag!=='string'||!/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag)||tag.length>50)throw new Error('发布版本无效');
  if(format!==undefined && format!=='folder' && format!=='single')throw new Error('下载格式无效');
  const version=tag.replace(/^v/,'');
  const filename=format==='folder'?`AVHub-folder-portable-${version}-x64.zip`:`AVHub-portable-${version}-x64.exe`;
  await shell.openExternal(format===undefined?`https://github.com/jhlxlml/avhub/releases/tag/${tag}`:`https://github.com/jhlxlml/avhub/releases/download/${tag}/${filename}`);return {ok:true};
});

function chooseDataDirectory(): string {
  if (process.env.AVHUB_DATA_DIR) {
    return writableDirectory(path.resolve(process.env.AVHUB_DATA_DIR));
  }
  const configured=readDataLocation(dataConfigFile);
  if(configured){pendingDataMigration=configured.pending;return writableDirectory(configured.directory);}
  const profileLegacy=path.join(!isPackaged&&process.env.AVHUB_APP_HOME?dataHome:app.getPath('userData'),'data');
  const homeLegacy=path.join(dataHome,'data');
  const legacy=existsSync(path.join(profileLegacy,'library.db'))?profileLegacy:existsSync(path.join(homeLegacy,'library.db'))?homeLegacy:profileLegacy;
  let directory:string;
  try{directory=writableDirectory(defaultDataDir);}
  catch {return writableDirectory(legacy);}
  if(existsSync(path.join(legacy,'library.db'))&&!existsSync(path.join(directory,'library.db'))) {
    const config=migrationConfig(legacy,directory);writeDataLocation(dataConfigFile,config);pendingDataMigration=config.pending;
  }
  return directory;
}

let dataLocationBusy=false;
ipcMain.handle('avhub:data-location',async(event,action:unknown)=>{
  const owner=trustedWindow(event);
  const info=()=>({current:dataDir,default:defaultDataDir,next:(process.env.AVHUB_DATA_DIR?undefined:readDataLocation(dataConfigFile)?.directory)||dataDir,locked:Boolean(process.env.AVHUB_DATA_DIR)});
  if(action==='get')return info();
  if(action!=='choose')throw new Error('数据目录操作无效');
  if(process.env.AVHUB_DATA_DIR)throw new Error('当前使用 AVHUB_DATA_DIR 环境变量，请先移除它再使用目录设置');
  if(dataLocationBusy||directoryDialogActive)throw new Error('请先完成当前目录操作');
  dataLocationBusy=true;
  try {
    const result=await dialog.showOpenDialog(owner,{title:'选择空的数据目录（下次启动迁移）',properties:['openDirectory'],defaultPath:dataDir});
    if(result.canceled||!result.filePaths.length)return {cancelled:true};const selected=result.filePaths[0];
    const config=migrationConfig(dataDir,selected);
    const confirmed=await dialog.showMessageBox(owner,{type:'question',title:'更换数据目录',message:'保存并在下次启动时迁移媒体库？',detail:`新位置：${config.directory}\n\n迁移索引、设置、观看记录与封面；旧目录保留。原视频、截图、临时播放缓存和 Chromium 配置不搬动。请正常退出应用后重新打开。`,buttons:['保存，下次启动生效','取消'],defaultId:0,cancelId:1});
    if(confirmed.response!==0)return {cancelled:true};
    writeDataLocation(dataConfigFile,config);return info();
  }finally{dataLocationBusy=false;}
});

// Electron creates its single-instance lock and Chromium profile under userData.
// Pick the same writable directory as the library before requesting that lock,
// otherwise portable launches can fail before our startup error handling runs.
try {
  dataDir = chooseDataDirectory();
  app.setPath('userData', dataDir);
} catch (error) {
  startupError = error instanceof Error ? error : new Error(String(error));
}

const hasSingleInstanceLock = startupError ? false : app.requestSingleInstanceLock();
if (!hasSingleInstanceLock && !startupError) app.quit();

async function freeLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无法分配本地服务端口');
  const { port } = address;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

function appendBackendLog(chunk: Buffer) {
  appendBoundedLog(dataDir, 'backend.log', chunk);
}

function appendDesktopLog(message: string) {
  if (!dataDir) return;
  appendBoundedLog(dataDir, 'desktop.log', `${new Date().toISOString()} ${message}\n`);
}

function startBackend(): ChildProcess {
  const env = {
    ...process.env,
    AVHUB_DATA_DIR: dataDir,
    AVHUB_PORT: String(backendPort),
    AVHUB_SESSION_TOKEN: sessionToken,
  };
  if (isPackaged) {
    const executable = path.join(process.resourcesPath, 'backend', 'AVHubServer.exe');
    return spawn(executable, ['--port', String(backendPort)], {
      cwd: path.dirname(executable), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
  return spawn(process.env.AVHUB_PYTHON || 'python', ['run.py', '--port', String(backendPort)], {
    cwd: projectRoot, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function waitForBackend(child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 45_000;
  const healthUrl = `http://127.0.0.1:${backendPort}/api/health`;
  const expectedSessionId = createHash('sha256').update(sessionToken).digest('hex').slice(0, 16);
  while (Date.now() < deadline) {
    if (backendExitCode !== null && backendExitCode !== undefined) {
      throw new Error(`媒体服务意外退出（${backendExitCode}），详情见数据目录中的 backend.log`);
    }
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1200) });
      const health = await response.json() as { ok?: boolean; port?: number; desktop_session?: boolean; session_id?: string };
      if (response.ok && health.ok && health.port === backendPort && health.desktop_session && health.session_id === expectedSessionId) {
        appendDesktopLog(`backend-ready port=${backendPort}`);
        startupTrace.mark('backend-ready');
        return;
      }
    } catch { /* The Python server may still be starting. */ }
    await delay(250);
  }
  child.kill();
  throw new Error('等待本地媒体服务启动超时，详情见数据目录中的 backend.log');
}

function createWindow(): BrowserWindow {
  const url = `http://127.0.0.1:${backendPort}`;
  const allowedOrigin = new URL(url).origin;
  const window = new BrowserWindow({
    icon: loadDesktopIcon(projectRoot, process.resourcesPath, isPackaged),
    show: isPackaged || process.env.AVHUB_HEADLESS_TEST !== '1',
    width: 1440,
    height: 900,
    minWidth: 760,
    minHeight: 560,
    // Frameless from creation: changing the OS frame by recreating a window
    // would destroy the active decoder. Keep native edge resizing (thickFrame).
    frame: false,
    backgroundColor: '#0b0f16',
    autoHideMenuBar: true,
    webPreferences: {
      backgroundThrottling: isPackaged || process.env.AVHUB_HEADLESS_TEST !== '1',
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  const publish = () => publishWindowState(window);
  let fullscreenTimer:ReturnType<typeof setTimeout>|undefined;
  const settleFullscreen=()=>{
    if(fullscreenTimer)clearTimeout(fullscreenTimer);
    // On Windows, isFullScreen() can still report the old value inside the
    // leave event. Wait for the native transition before fitting/publishing.
    fullscreenTimer=setTimeout(()=>{if(!window.isDestroyed()){fitPlaybackWindow(window);publish();}},50);
  };
  window.on('enter-full-screen', publish);
  window.on('leave-full-screen', settleFullscreen);
  window.on('leave-html-full-screen', settleFullscreen);
  window.on('maximize', ()=>{
    // Native titlebar double-click / OS maximize must also preserve video ratio.
    if(purePlayback && playbackAspectRatio && !fittingPlaybackWindow) {
      window.unmaximize();expandedPlaybackBounds ??=window.getContentBounds();fitPlaybackWindow(window,true);
    }
    publish();
  });
  window.on('unmaximize', publish);
  window.on('restore',()=>{fitPlaybackWindow(window);publish();});
  window.on('always-on-top-changed', publish);
  window.on('will-resize',()=>{
    if(purePlayback && expandedPlaybackBounds) {expandedPlaybackBounds=null;publish();}
  });
  let resizeTimer:ReturnType<typeof setTimeout>|undefined;
  window.on('resize',()=>{
    if(resizeTimer)clearTimeout(resizeTimer);
    if(!purePlayback || !playbackAspectRatio || fittingPlaybackWindow || window.isFullScreen())return;
    // setAspectRatio constrains native dragging. OS snap/programmatic resize
    // bypasses it, so repair once after resizing, never on video time updates.
    resizeTimer=setTimeout(()=>{
      if(window.isDestroyed() || !purePlayback || !playbackAspectRatio)return;
      const bounds=window.getContentBounds();
      if(Math.abs(bounds.width-bounds.height*playbackAspectRatio)>2) {
        expandedPlaybackBounds=null;fitPlaybackWindow(window,false);publish();
      }
    },80);
  });
  window.on('closed',()=>{if(resizeTimer)clearTimeout(resizeTimer);if(fullscreenTimer)clearTimeout(fullscreenTimer);});
  window.on('close',event=>{
    if(!allowQuit){event.preventDefault();app.quit();}
  });
  window.webContents.session.setPermissionCheckHandler((contents, permission, requestingOrigin, details) =>
    contents === window.webContents && permissionAllowed(permission, details.requestingUrl || requestingOrigin, allowedOrigin, details.isMainFrame));
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) =>
    callback(contents === window.webContents && permissionAllowed(permission, details.requestingUrl, allowedOrigin, details.isMainFrame)));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('context-menu',(event,params)=>{
    if(shuttingDown||allowQuit||window.isDestroyed()||params.frame!==window.webContents.mainFrame)return;
    try {if(new URL(params.frame.url).origin!==allowedOrigin)return;}catch{return;}
    const template=textEditTemplate(params);
    if(!template.length)return;
    event.preventDefault();
    Menu.buildFromTemplate(template).popup({window,frame:params.frame,sourceType:params.menuSourceType});
  });
  window.on('app-command',(event,command)=>{
    if(command!=='browser-backward'&&command!=='browser-forward')return;
    if(shuttingDown||allowQuit||window.isDestroyed())return;
    try {
      const current=new URL(window.webContents.getURL());
      const mediaId=Number(current.searchParams.get('video'));
      if(current.origin!==allowedOrigin||!Number.isSafeInteger(mediaId)||mediaId<=0)return;
    } catch {return;}
    event.preventDefault();
    window.webContents.send('avhub:mouse-seek',command==='browser-forward'?'forward':'back');
  });
  window.webContents.once('did-finish-load',()=>{
    appendDesktopLog('renderer-loaded');startupTrace.mark('renderer-loaded');
  });
  if (!isPackaged && process.env.AVHUB_SMOKE_TEST === '1') {
    window.webContents.once('did-finish-load', () => {
      setTimeout(() => app.quit(), 300);
    });
    window.webContents.once('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      if (!isMainFrame) return;
      appendDesktopLog(`renderer-load-failed code=${code} ${description}`);
      process.exitCode = 1;
      app.quit();
    });
  }
  window.webContents.on('will-navigate', (event, destination) => {
    try {
      if (new URL(destination).origin !== allowedOrigin) event.preventDefault();
    } catch { event.preventDefault(); }
  });
  void window.loadURL(url);
  return window;
}

async function startApplication() {
  appendDesktopLog('startup-begin');
  startupTrace.mark('begin');
  if(pendingDataMigration) {
    const pending=pendingDataMigration;
    const executable=isPackaged?path.join(process.resourcesPath,'backend','AVHubServer.exe'):(process.env.AVHUB_PYTHON||'python');
    const args=[...(isPackaged?[]:['run.py']),'--migrate-data',pending.source,pending.target,pending.id];
    const child=spawn(executable,args,{cwd:isPackaged?path.dirname(executable):projectRoot,windowsHide:true,stdio:['ignore','pipe','pipe']});
    backend=child;
    let diagnostic='';child.stderr?.on('data',chunk=>{diagnostic=(diagnostic+chunk.toString()).slice(-4096);});
    await new Promise<void>((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`数据迁移失败，旧数据仍在 ${pending.source}。请检查目标空间与权限后重试。\n${diagnostic}`)));});
    backend=null;
    const config=readDataLocation(dataConfigFile);
    if(config?.pending?.id!==pending.id)throw new Error('数据目录配置在迁移期间发生变化');
    writeDataLocation(dataConfigFile,{version:1,directory:pending.target});pendingDataMigration=undefined;
  }
  backendPort = await freeLoopbackPort();
  sessionToken = randomBytes(32).toString('hex');
  appendDesktopLog(`backend-start port=${backendPort}`);
  startupTrace.mark('backend-start');
  backend = startBackend();
  backend.stdout?.on('data', appendBackendLog);
  backend.stderr?.on('data', appendBackendLog);
  backend.on('exit', code => {
    backendExitCode = code;
    if (applicationStarted && !shuttingDown && !allowQuit) {
      dialog.showErrorBox('AVHub 媒体服务已停止', `AVHub 的本地服务意外退出（${code ?? '未知'}）。\n\n日志文件：${path.join(dataDir, 'backend.log')}`);
      allowQuit = true;
      app.quit();
    }
  });
  backend.on('error', error => appendBackendLog(Buffer.from(`启动失败：${error.message}\n`)));
  await waitForBackend(backend);
  if (backendExitCode !== null && backendExitCode !== undefined) throw new Error('媒体服务启动后立即退出，请查看 backend.log');
  mainWindow = createWindow();
  mainWindow.on('closed', () => { mainWindow = null; });
  applicationStarted = true;
  appendDesktopLog('window-created');
  startupTrace.mark('window-created');
}

async function stopBackend() {
  const child = backend;
  if (child) await stopOwnedBackend(child, `http://127.0.0.1:${backendPort}`, sessionToken, appendDesktopLog);
}

app.on('before-quit', event => {
  if (allowQuit) return;
  event.preventDefault();
  if (shuttingDown) return;
  shuttingDown = true;
  appendDesktopLog('shutdown-start');
  void (async()=>{
    while(mainWindow && !mainWindow.isDestroyed()) {
      let saved:boolean|'data-commit'=false;
      try {
        saved=await Promise.race([
          mainWindow.webContents.executeJavaScript(`(async()=>{
            const tasks=[];
            window.dispatchEvent(new CustomEvent('avhub-before-quit',{detail:tasks}));
            if(tasks.criticalDataCommit)return 'data-commit';
            return (await Promise.all(tasks)).every(value=>value!==false);
          })()`),
          delay(5000).then(()=>false),
        ]);
      } catch(error) { appendDesktopLog(`renderer-save-error ${String(error)}`); }
      appendDesktopLog(`renderer-save-complete success=${saved}`);
      if(saved==='data-commit'){
        appendDesktopLog('quit-deferred-data-commit');
        await dialog.showMessageBox(mainWindow,{type:'info',title:'正在提交媒体库恢复',message:'恢复正在提交，暂时不能关闭应用。',detail:'请等待恢复完成，避免中断数据库与图片写入。',buttons:['返回应用']});
        shuttingDown=false;
        if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('avhub:quit-cancelled');
        return;
      }
      if(saved)break;
      const choice=await dialog.showMessageBox(mainWindow,{type:'warning',title:'退出前保存失败',
        message:'播放进度、媒体信息、设置或截图尚未保存。',detail:'可以重试等待保存、放弃本次未保存的更改并退出，或返回应用。',
        buttons:['重试保存','仍然退出','取消退出'],defaultId:0,cancelId:2});
      if(choice.response===2){
        shuttingDown=false;
        if(mainWindow && !mainWindow.isDestroyed())mainWindow.webContents.send('avhub:quit-cancelled');
        return;
      }
      if(choice.response===1)break;
    }
    // Saving/discard confirmation is complete. Destroy the renderer BEFORE
    // waiting for Uvicorn: paused video/Range/HLS connections otherwise keep
    // the service draining while the still-open window appears frozen.
    if(mainWindow && !mainWindow.isDestroyed())mainWindow.destroy();
    appendDesktopLog('playback-window-released');
    try {await stopBackend();}
    finally {
      appendDesktopLog('shutdown-complete');
      allowQuit = true;
      app.quit();
    }
  })().catch(error=>{
    appendDesktopLog(`shutdown-error ${String(error)}`);
    if(!mainWindow || mainWindow.isDestroyed()){allowQuit=true;app.quit();}
    else {shuttingDown=false;mainWindow.webContents.send('avhub:quit-cancelled');}
  });
});

app.on('window-all-closed', () => app.quit());
app.on('activate', () => {
  if (!shuttingDown && !allowQuit && BrowserWindow.getAllWindows().length === 0 && backendExitCode == null) mainWindow = createWindow();
});

app.whenReady().then(async () => {
  if (startupError) throw startupError;
  if (!hasSingleInstanceLock) return;
  app.setAppUserModelId('local.avhub.desktop');
  await startApplication();
}).catch(error => {
  appendDesktopLog(`startup-error ${error instanceof Error ? error.message : String(error)}`);
  dialog.showErrorBox('AVHub 启动失败', error instanceof Error ? error.message : String(error));
  allowQuit = true;
  app.quit();
});
