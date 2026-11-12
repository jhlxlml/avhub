using System;using System.Text;using System.IO;using System.Drawing;using System.Threading;using System.Globalization;using System.Runtime.InteropServices;using System.Collections.Generic;using System.Web.Script.Serialization;using System.Windows.Forms;

// No renderer, file picker or shell lives here. Only the owning Electron main
// process may send this private stdin protocol. Paths never cross the public IPC.
sealed class RenderHost : Form {
 [DllImport("user32")]static extern bool SetProcessDpiAwarenessContext(IntPtr context);
 [StructLayout(LayoutKind.Sequential)]struct IoCounters {public ulong ReadOperations,WriteOperations,OtherOperations,ReadBytes,WriteBytes,OtherBytes;}
 [DllImport("kernel32",SetLastError=true)]static extern bool GetProcessIoCounters(IntPtr process,out IoCounters counters);
 readonly string dll,source,shaderCache;int width,height;long surfaceGeneration;readonly double start;readonly bool autoplay,notifyFrames;readonly object openId;readonly IntPtr displayWindow;
 readonly System.Diagnostics.Stopwatch seekClock=new System.Diagnostics.Stopwatch();
 double? seekEventMs,restartMs,correctionStartedMs;
 bool keyframeSeek,keyframeForward,exactEndFallback,cachePaused;
 double? cacheStartMs;
 double cacheWaitMs;
 int sourceLoads;
 ulong seekCommandSequence,seekCommandPending;Action queuedPosition;double nativeQueueMs;int seekCommands,seekCoalesced;
 readonly Dictionary<string,object> frameProperties=new Dictionary<string,object>();
 string outputTransfer="srgb";
 readonly JavaScriptSerializer json=new JavaScriptSerializer{MaxJsonLength=262144};
 readonly AutoResetEvent wake=new AutoResetEvent(false);readonly ManualResetEvent ready=new ManualResetEvent(false),quiesced=new ManualResetEvent(false);readonly object frameGate=new object();
 double deviceReadyMs,renderContextMs;
 MpvCore mpv;D3dSurface surface;Thread renderer;MpvCore.Wake update;volatile bool stopping;volatile string renderError;
 long frameEpoch,seekId,serial,subtitleFrameSerial;int redraw,seekCorrections,totalSeekCorrections;volatile bool admissionClosed;bool loaded,seekRequested,sawSeek,restarted,subtitleRefreshPending,subtitleSeek,resumeAfterSubtitleRefresh;double target,demuxerOffset;string failure;
 long pendingSerial,pendingEpoch;bool pendingContent;object published;System.Windows.Forms.Timer watchdog;
 protected override bool ShowWithoutActivation {get{return true;}}
 protected override CreateParams CreateParams {get{var p=base.CreateParams;p.ExStyle|=0x08000000;return p;}}
 static double Number(object value,double min,double max){double v=Convert.ToDouble(value,CultureInfo.InvariantCulture);if(double.IsNaN(v)||double.IsInfinity(v)||v<min||v>max)throw new Exception("Invalid native value");return v;}
 static long Integer(object value,long min,long max){double n=Number(value,min,max);if(n!=Math.Truncate(n))throw new Exception("Invalid native integer");return (long)n;}
 static string Num(double value){return value.ToString("R",CultureInfo.InvariantCulture);}
 static bool Boolean(object value){if(!(value is bool))throw new Exception("Invalid native flag");return (bool)value;}
 static Dictionary<string,object> Object(object value){var r=value as Dictionary<string,object>;if(r==null)throw new Exception("Invalid native request");return r;}
 public RenderHost(string library,Dictionary<string,object> request){
  dll=library;openId=request["id"];if((string)request["action"]!="open")throw new Exception("First request must open an authorized source");object window;displayWindow=new IntPtr(request.TryGetValue("windowHandle",out window)?long.Parse((string)window):0);
  object notifications;notifyFrames=request.TryGetValue("frameNotifications",out notifications)&&Boolean(notifications);
  object cache;if(request.TryGetValue("shaderCache",out cache)&&cache!=null){shaderCache=(string)cache;if(!Path.IsPathRooted(shaderCache)||!Directory.Exists(shaderCache))throw new Exception("Invalid shader cache directory");}
  source=Path.GetFullPath((string)request["path"]);if(!Path.IsPathRooted((string)request["path"])||!File.Exists(source))throw new Exception("Authorized source unavailable");
  // The decoder, not a separate FFprobe admission pass, supplies geometry.
  start=Number(request["startSec"],0,double.MaxValue);autoplay=Boolean(request["autoplay"]);Text="AVHub Native Render Host";FormBorderStyle=FormBorderStyle.None;ClientSize=new Size(16,16);ShowInTaskbar=false;Opacity=0;
 }
 protected override void OnShown(EventArgs e){base.OnShown(e);Hide();
  var startup=System.Diagnostics.Stopwatch.StartNew();mpv=new MpvCore(dll,true,shaderCache);double coreMs=startup.Elapsed.TotalMilliseconds;startup.Restart();renderer=new Thread(RenderLoop){IsBackground=true,Name="AVHub D3D11 Render"};renderer.Start();if(!ready.WaitOne(25000)||renderError!=null)throw new Exception("Native renderer initialization failed");
  double rendererReadyMs=startup.Elapsed.TotalMilliseconds;startup.Restart();
  mpv.Cmd("loadfile",source,"replace","-1","start="+Num(start));mpv.Cmd("set","pause",autoplay?"no":"yes");
  var startupMs=new Dictionary<string,double>(mpv.StartupMs);startupMs["coreMs"]=coreMs;startupMs["rendererReadyMs"]=rendererReadyMs;startupMs["deviceReadyMs"]=deviceReadyMs;startupMs["renderContextMs"]=renderContextMs;startupMs["loadCommandMs"]=startup.Elapsed.TotalMilliseconds;
  Reply(openId,new{ok=true,protocol=1,startupMs},null);var input=new Thread(ReadInput){IsBackground=true,Name="AVHub Native Commands"};input.Start();
  // Render failure must become an error even if nobody is polling the pipe.
  watchdog=new System.Windows.Forms.Timer{Interval=250};watchdog.Tick+=delegate{DrainEvents();if(renderError!=null)failure="NATIVE_RENDER";};watchdog.Start();
 }
 void RenderLoop(){try{
  // A private bootstrap target establishes libmpv's device before decoding.
  // It is never imported or displayed; only full decoded-size targets publish.
  var setup=System.Diagnostics.Stopwatch.StartNew();surface=new D3dSurface(16,16,true);deviceReadyMs=setup.Elapsed.TotalMilliseconds;setup.Restart();update=delegate{wake.Set();};mpv.CreateRenderer(surface.Device,update);renderContextMs=setup.Elapsed.TotalMilliseconds;ready.Set();bool pending=false,requestedRedraw=false,contentEver=false;
  while(!stopping){wake.WaitOne(100);if(admissionClosed){quiesced.Set();continue;}requestedRedraw=Interlocked.Exchange(ref redraw,0)!=0||requestedRedraw;pending=mpv.NeedsFrame()||requestedRedraw||pending;if(!pending||surface.AwaitingRelease)continue;
   lock(frameGate){if(width>0&&height>0&&(surface.Width!=width||surface.Height!=height||surfaceGeneration==0)){surface.Resize(width,height);surfaceGeneration++;requestedRedraw=true;}}
   long epoch=Interlocked.Read(ref frameEpoch);ulong flags=mpv.FrameFlags();bool content=(flags&1)!=0||requestedRedraw&&contentEver;surface.LockForDraw();mpv.Draw(surface.Texture);contentEver=contentEver||content;
   // Publish readiness and metadata under the same lock: a poll must never
   // observe a newly completed texture with the previous frame's identity.
   // The ready-notification client wakes after publication, so it need not
   // block its command pipe on a GPU wait just to discover readiness. Retain
   // the old lock/poll behavior for clients that did not opt into notifications.
   if(notifyFrames)surface.WaitForDrawCompletion();
   lock(frameGate){if(notifyFrames)surface.PublishCompletedDraw();else surface.UnlockAfterDraw();pendingSerial=++serial;pendingEpoch=epoch;pendingContent=content;}pending=false;requestedRedraw=false;
   // A hint after real GPU completion and atomic publication, never a receipt.
   // Console.Out synchronizes each complete line with command responses.
   if(notifyFrames&&!admissionClosed&&!stopping)Console.WriteLine("{\"event\":\"frame-ready\",\"serial\":"+serial.ToString(CultureInfo.InvariantCulture)+"}");
  }
 }catch(Exception ex){renderError=ex.GetType().Name;ready.Set();}finally{if(mpv!=null)mpv.FreeRenderer();if(surface!=null)surface.Dispose();}}
 void DrainEvents(){if(mpv==null)return;for(int i=0;i<256;i++){
  var e=mpv.NextEvent();if(e.id==0)break;
  if(e.cachePaused.HasValue){
   cachePaused=e.cachePaused.Value;
   if(cachePaused&&!cacheStartMs.HasValue)cacheStartMs=seekClock.Elapsed.TotalMilliseconds;
   if(!cachePaused&&cacheStartMs.HasValue){cacheWaitMs+=seekClock.Elapsed.TotalMilliseconds-cacheStartMs.Value;cacheStartMs=null;}
  }
  if(e.propertyName!=null){
   frameProperties[e.propertyName]=e.propertyValue;
  }
  if(e.id==6)sourceLoads++;
  if(e.id==8)loaded=true;
  if(e.id==20&&seekRequested){if(!keyframeSeek)Interlocked.Increment(ref frameEpoch);sawSeek=true;restarted=false;if(!seekEventMs.HasValue)seekEventMs=seekClock.Elapsed.TotalMilliseconds;}
  if(e.id==21){if(seekRequested&&sawSeek){restarted=true;restartMs=seekClock.Elapsed.TotalMilliseconds;if(keyframeSeek)Interlocked.Increment(ref frameEpoch);Interlocked.Exchange(ref redraw,1);wake.Set();}}
  if(e.id==7&&e.error<0)failure="NATIVE_DECODE_"+e.error;
  if(e.id==5&&e.userdata==seekCommandPending){seekCommandPending=0;if(e.error<0){if(queuedPosition==null)failure="NATIVE_SEEK_"+e.error;else Console.Error.WriteLine("NATIVE_SUPERSEDED_SEEK_ERROR "+e.error);}}
 }
 // One core command and one newest target. Keep draining events and releasing
 // textures while the playback core processes a seek; a synchronous command
 // here can otherwise block the very frame ACK it needs to make progress.
 if(seekCommandPending==0&&queuedPosition!=null&&!admissionClosed){var next=queuedPosition;queuedPosition=null;try{next();}catch(Exception ex){failure="NATIVE_SEEK_SUBMIT";Console.Error.WriteLine("NATIVE_SEEK_SUBMIT "+ex.Message);}}
 }
 object Frame(){DrainEvents();if(renderError!=null)failure="NATIVE_RENDER";
  // A forward keyframe seek can run beyond the last index entry. Do not label
  // an EOF redraw as the requested video frame: really decode the exact end target.
  if(seekRequested&&queuedPosition==null&&seekCommandPending==0&&keyframeForward&&sawSeek&&restarted&&Equals(mpv.Property("eof-reached"),true)){
   keyframeForward=false;keyframeSeek=false;exactEndFallback=true;seekCorrections++;totalSeekCorrections++;correctionStartedMs=seekClock.Elapsed.TotalMilliseconds;
   sawSeek=false;restarted=false;Interlocked.Increment(ref frameEpoch);
   if(published==null)surface.AwaitingRelease=false;
   wake.Set();SubmitPosition(Num(target),"absolute+exact");return new{waiting=false,error=failure};
  }long frame,epoch;bool content,waiting;lock(frameGate){frame=pendingSerial;epoch=pendingEpoch;content=pendingContent;waiting=surface!=null&&surface.AwaitingRelease;}
  if(!waiting||frame<=0)return new{waiting=false,error=failure};
  if(published==null||((Dictionary<string,object>)published)["serial"].ToString()!=frame.ToString()){
   // Retire an unpublished old epoch before asking the core for metadata.
   // A synchronous getter here can wait on VO, which is waiting for our draw.
   if(epoch!=Interlocked.Read(ref frameEpoch)){surface.AwaitingRelease=false;wake.Set();return new{waiting=false,error=failure};}
   object value;frameProperties.TryGetValue("video-params",out value);var geometry=value as Dictionary<string,object>;
   // Startup clears are not decoded first frames and have no GPU importers.
   // Retire only these unpublished surfaces so they cannot block real video.
   if(!content||!loaded||geometry==null){surface.AwaitingRelease=false;wake.Set();return new{waiting=false,error=failure};}
   VerifyGeometry(geometry);
   // A decoder can reveal HDR absent from the header probe. Retire the old
   // colour generation before importing any pixels with the new declaration.
   if(epoch!=Interlocked.Read(ref frameEpoch)||surfaceGeneration==0||surface.Width!=width||surface.Height!=height){surface.AwaitingRelease=false;wake.Set();return new{waiting=false,error=failure};}
   frameProperties.TryGetValue("time-pos",out value);double seconds=value==null?0:Convert.ToDouble(value);frameProperties.TryGetValue("seeking",out value);bool seeking=Equals(value,true);
   // A new seek's label is withheld until libmpv has processed it and restarted.
   // The renderer additionally confirms GPU completion; time-pos alone is never
   // a seek completion signal. Pixel-coded Electron acceptance checks accuracy.
   bool completed=seekRequested&&queuedPosition==null&&seekCommandPending==0&&sawSeek&&restarted&&!seeking&&epoch==Interlocked.Read(ref frameEpoch);
   // time-pos events can still contain the requested timestamp immediately
   // after a keyframe seek. Query only after restart, when this epoch has
   // actually rendered, so an approximate landing cannot claim that target.
   if(completed){
    var actual=mpv.Property("time-pos");if(actual==null)return new{waiting=false,error=failure};
    seconds=Convert.ToDouble(actual);
   }
   frameProperties.TryGetValue("pause",out value);bool paused=Equals(value,true);double tolerance=.1;if(completed&&paused){object rate;frameProperties.TryGetValue("container-fps",out rate);if(rate!=null){double fps=Convert.ToDouble(rate);if(!double.IsNaN(fps)&&!double.IsInfinity(fps)&&fps>=1&&fps<=240)tolerance=Math.Min(.1,1/fps+.002);}}
   // Some MPEG-TS demuxers jump to a later keyframe even for exact seeks.
   // Retry only witnessed overshoot, at most twice. Freeze while correcting;
   // the application resumes after the corrected frame's real GPU receipt.
   if(completed&&!keyframeSeek&&(seconds>target+tolerance||subtitleSeek&&Math.Abs(seconds-target)>tolerance)&&seekCorrections<2){
    if(!paused)mpv.Cmd("set","pause","yes");
    if(!correctionStartedMs.HasValue)correctionStartedMs=seekClock.Elapsed.TotalMilliseconds;
    seekCorrections++;totalSeekCorrections++;demuxerOffset=Math.Min(8,(Math.Abs(seconds-target)+2)*seekCorrections);
    mpv.Cmd("set","options/hr-seek-demuxer-offset",Num(demuxerOffset));
    sawSeek=false;restarted=false;Interlocked.Increment(ref frameEpoch);
    surface.AwaitingRelease=false;published=null;wake.Set();SubmitPosition(Num(target),"absolute+exact");
    return new{waiting=false,error=failure};
   }
   bool matched=completed&&(keyframeSeek||Math.Abs(seconds-target)<=tolerance);long label=matched&&!subtitleSeek?seekId:0;
   if(completed&&subtitleSeek&&!matched&&seekCorrections>=2){failure="NATIVE_SUBTITLE_REFRESH";admissionClosed=true;surface.AwaitingRelease=false;published=null;return new{waiting=false,error=failure};}
   if(matched){if(subtitleSeek)subtitleFrameSerial=frame;seekRequested=false;subtitleSeek=false;if(demuxerOffset>0){mpv.Cmd("set","options/hr-seek-demuxer-offset","0");demuxerOffset=0;}}
   published=new Dictionary<string,object>{{"serial",frame},{"epoch",epoch},{"seekId",label},{"positionSec",seconds},{"seekTiming",label==0?null:(object)new{seekEventMs,restartMs,nativeQueueMs,nativeFrameMs=seekClock.Elapsed.TotalMilliseconds,exactFallback=exactEndFallback,cacheWaitMs=cacheWaitMs+(cacheStartMs.HasValue?seekClock.Elapsed.TotalMilliseconds-cacheStartMs.Value:0),corrections=seekCorrections,correctionMs=correctionStartedMs.HasValue?(double?)(seekClock.Elapsed.TotalMilliseconds-correctionStartedMs.Value):null}},{"handle",surface.Handle},{"surfaceGeneration",surfaceGeneration},{"width",surface.Width},{"height",surface.Height},{"pixelFormat","rgbaf16"},{"outputTransfer",outputTransfer},{"waiting",true},{"error",failure}};
  }((Dictionary<string,object>)published)["error"]=failure;return published;
 }
 void VerifyGeometry(Dictionary<string,object> geometry){if(geometry!=null){
   object primaries,gamma,matrix,rotate,pixel;geometry.TryGetValue("primaries",out primaries);geometry.TryGetValue("gamma",out gamma);geometry.TryGetValue("colormatrix",out matrix);geometry.TryGetValue("rotate",out rotate);geometry.TryGetValue("pixelformat",out pixel);if(Equals(pixel,"d3d11"))geometry.TryGetValue("hw-pixelformat",out pixel);
   // Decoder formats, source tags, rotation and SAR belong to libmpv.
   if(gamma is string&&!Equals(gamma,"unknown"))ConfigureOutput(Equals(gamma,"pq")||Equals(gamma,"hlg")?(string)gamma:"srgb");
   double sourceWidth=Number(geometry["w"],1,16384),sourceHeight=Number(geometry["h"],1,16384);object par;
   double aspect=geometry.TryGetValue("par",out par)?Number(par,double.Epsilon,double.MaxValue):1;
   double fullWidth=aspect>=1?Math.Ceiling(sourceWidth*aspect):sourceWidth,fullHeight=aspect<1?Math.Ceiling(sourceHeight/aspect):sourceHeight;
   double angle=(rotate==null?0:Number(rotate,-360,360))*Math.PI/180;
   int nextWidth=(int)Integer(Math.Ceiling(Math.Round(Math.Abs(fullWidth*Math.Cos(angle))+Math.Abs(fullHeight*Math.Sin(angle)),8)),1,16384);
   int nextHeight=(int)Integer(Math.Ceiling(Math.Round(Math.Abs(fullWidth*Math.Sin(angle))+Math.Abs(fullHeight*Math.Cos(angle)),8)),1,16384);
   lock(frameGate){if(width!=nextWidth||height!=nextHeight){width=nextWidth;height=nextHeight;Interlocked.Increment(ref frameEpoch);Interlocked.Exchange(ref redraw,1);wake.Set();}}
   if(failure!=null){admissionClosed=true;wake.Set();mpv.Cmd("set","pause","yes");}
  }}
 void ConfigureOutput(string transfer){
  if(transfer==outputTransfer)return;
  mpv.Cmd("set","options/target-prim",transfer=="srgb"?"bt.709":"bt.2020");
  mpv.Cmd("set","options/target-trc",transfer);
  mpv.Cmd("set","options/target-peak","auto");
  outputTransfer=transfer;Interlocked.Increment(ref frameEpoch);Interlocked.Exchange(ref redraw,1);wake.Set();
 }
 void RefreshPausedSubtitles(){
  // Selecting a subtitle can leave its decoder empty until another video
  // frame is decoded. Reposition to this paused frame, never start playback
  // or replace the source. An outstanding user seek already performs this
  // decode and must retain its target/receipt identity.
  if(!loaded||!Equals(mpv.Property("pause"),true)){subtitleRefreshPending=false;return;}
  subtitleRefreshPending=true;TryRefreshPausedSubtitles();
 }
 void TryRefreshPausedSubtitles(){
  if(!subtitleRefreshPending||seekRequested||surface!=null&&surface.AwaitingRelease)return;
  subtitleRefreshPending=false;if(!loaded||!Equals(mpv.Property("pause"),true))return;
  var position=mpv.Property("time-pos");if(position==null)return;double seconds=Number(position,0,double.MaxValue);
  BeginExactPosition(seconds,true);
 }
 void BeginExactPosition(double seconds,bool forSubtitle,bool keyframe=false){
  if(seekCommandPending!=0){if(queuedPosition!=null)seekCoalesced++;seekRequested=true;long queuedAt=System.Diagnostics.Stopwatch.GetTimestamp();queuedPosition=delegate{double waited=(System.Diagnostics.Stopwatch.GetTimestamp()-queuedAt)*1000.0/System.Diagnostics.Stopwatch.Frequency;BeginExactPosition(seconds,forSubtitle,keyframe);nativeQueueMs=waited;};return;}
  nativeQueueMs=0;
  bool stableKeyframe=!seekRequested;
  if(demuxerOffset>0){mpv.Cmd("set","options/hr-seek-demuxer-offset","0");demuxerOffset=0;}
  if(!forSubtitle){resumeAfterSubtitleRefresh=false;subtitleFrameSerial=0;}subtitleSeek=forSubtitle;target=seconds;seekCorrections=0;seekRequested=true;sawSeek=false;restarted=false;Interlocked.Increment(ref frameEpoch);
  keyframeSeek=keyframe;exactEndFallback=false;seekEventMs=null;restartMs=null;correctionStartedMs=null;seekClock.Restart();mpv.ResetTrace();cacheWaitMs=0;cacheStartMs=cachePaused?(double?)0:null;
  keyframeForward=false;
  if(keyframe){var position=stableKeyframe&&!Equals(mpv.Property("seeking"),true)?mpv.Property("time-pos"):null;keyframeForward=position!=null&&target>Convert.ToDouble(position);SubmitPosition(Num(position==null?target:target-Convert.ToDouble(position)),position==null?"absolute+keyframes":"relative+keyframes");}
  else SubmitPosition(Num(target),"absolute+exact");
 }
 void SubmitPosition(string seconds,string mode){ulong id=++seekCommandSequence;mpv.CmdAsync(id,"seek",seconds,mode);seekCommandPending=id;seekCommands++;}
 object Snapshot(){DrainEvents();var properties=new Dictionary<string,object>();
  // A pending seek can make a synchronous pause/time getter wait on VO,
  // preventing our next frame request. Observe it here; Frame still queries
  // the real landing after restart before issuing a seek/GPU receipt.
  // Outside that pending interval control clocks are read back immediately.
  foreach(var name in new[]{"time-pos","duration","pause","volume","mute","speed","eof-reached","seeking","paused-for-cache","track-list","aid","sid","sub-delay","sub-text","video-params","video-out-params","audio-params","audio-out-params","current-ao","current-demuxer","avsync","hwdec-current","decoder-frame-drop-count","frame-drop-count"})properties[name]=name=="paused-for-cache"?(object)cachePaused:(seekRequested||name!="pause"&&name!="time-pos")&&frameProperties.ContainsKey(name)?frameProperties[name]:mpv.Property(name);
  properties["avhub-native-seek-trace"]=mpv.Trace();properties["avhub-seek-dispatches"]=seekCommands;properties["avhub-seek-coalesced"]=seekCoalesced;properties["avhub-source-loads"]=sourceLoads;properties["avhub-seek-corrections"]=totalSeekCorrections;properties["avhub-subtitle-refresh"]=subtitleRefreshPending||subtitleSeek||subtitleFrameSerial!=0;VerifyGeometry(properties["video-params"] as Dictionary<string,object>);properties["avhub-output-transfer"]=outputTransfer;properties["avhub-render-size"]=new{width=width,height=height};
  return new{loaded=loaded,error=failure,properties=properties,frame=Frame(),adapter=surface==null?null:surface.Description};
 }
 object Dispatch(Dictionary<string,object> r){DrainEvents();string action=(string)r["action"];object value;r.TryGetValue("value",out value);
  switch(action){
  case "snapshot":return Snapshot();case "frame":return Frame();case "display":return DisplayProbe.Read(displayWindow);
  case "resources":using(var process=System.Diagnostics.Process.GetCurrentProcess()){IoCounters io;if(!GetProcessIoCounters(process.Handle,out io))throw new Exception("Process I/O unavailable");return new{handles=process.HandleCount,cpuTimeMs=process.TotalProcessorTime.TotalMilliseconds,workingSetBytes=process.WorkingSet64,privateBytes=process.PrivateMemorySize64,processIoIncludingPipes=io,gpuMemory=surface==null?null:(object)surface.CheckBudget(false)};}
  case "quiesce":admissionClosed=true;queuedPosition=null;subtitleRefreshPending=false;resumeAfterSubtitleRefresh=false;subtitleFrameSerial=0;wake.Set();if(renderError==null&&!quiesced.WaitOne(2000))throw new Exception("Native frame admission did not stop");mpv.Cmd("set","pause","yes");return new{ok=true};
  case "ack":if(surface!=null&&Integer(value,1,long.MaxValue)==surface.Frame){if(subtitleFrameSerial==surface.Frame)subtitleFrameSerial=0;surface.AwaitingRelease=false;published=null;TryRefreshPausedSubtitles();if(resumeAfterSubtitleRefresh&&!seekRequested&&!subtitleRefreshPending&&subtitleFrameSerial==0){resumeAfterSubtitleRefresh=false;mpv.Cmd("set","pause","no");}wake.Set();}break;
  case "play":if(subtitleSeek||subtitleRefreshPending||subtitleFrameSerial!=0)resumeAfterSubtitleRefresh=true;else{resumeAfterSubtitleRefresh=false;mpv.Cmd("set","pause","no");}break;case "pause":resumeAfterSubtitleRefresh=false;mpv.Cmd("set","pause","yes");break;
  case "seek":var seek=Object(value);double nextTarget=Number(seek["seconds"],0,double.MaxValue);long next=Integer(seek["seekId"],1,9007199254740991);if(next<=seekId)throw new Exception("Stale native seek");subtitleRefreshPending=false;seekId=next;object keyframe;BeginExactPosition(nextTarget,false,seek.TryGetValue("keyframe",out keyframe)&&Boolean(keyframe));break;
  case "cancel-seek":var cancel=Object(value);if(Integer(cancel["seekId"],1,9007199254740991)==seekId){queuedPosition=null;seekRequested=false;subtitleSeek=false;sawSeek=false;restarted=false;if(demuxerOffset>0){mpv.Cmd("set","options/hr-seek-demuxer-offset","0");demuxerOffset=0;}TryRefreshPausedSubtitles();}break;
  case "volume":mpv.Cmd("set","volume",Num(Number(value,0,1)*100));break;
  case "mute":mpv.Cmd("set","mute",Boolean(value)?"yes":"no");break;
  case "rate":mpv.Cmd("set","speed",Num(Number(value,.25,4)));break;
  case "subtitle-delay":mpv.Cmd("set","sub-delay",Num(Number(value,-10,10)));break;
  case "subtitle-style":var style=Object(value);int size=(int)Integer(style["size"],22,38);string color=(string)style["color"];double background=Number(style["background"],0,.85);if(Array.IndexOf(new[]{22,26,30,34,38},size)<0||Array.IndexOf(new[]{"#ffffff","#ffe38a","#9de7ff"},color)<0||Array.IndexOf(new[]{0,.35,.65,.85},background)<0)throw new Exception("Invalid subtitle style");mpv.Cmd("set","sub-ass-override","no");mpv.Cmd("set","sub-font-size",size.ToString());mpv.Cmd("set","sub-color",color);mpv.Cmd("set","sub-back-color","#"+((int)Math.Round(background*255)).ToString("x2")+"000000");mpv.Cmd("set","sub-border-style","background-box");break;
  case "track":var track=Object(value);string type=(string)track["type"];if(type!="audio"&&type!="subtitle")throw new Exception("Invalid track type");string id=track["id"]==null?"no":Integer(track["id"],1,int.MaxValue).ToString();if(id!="no"){
   bool found=false;var tracks=mpv.Property("track-list") as object[];if(tracks!=null)foreach(var item in tracks){var t=Object(item);if(Convert.ToString(t["type"])==(type=="audio"?"audio":"sub")&&Convert.ToString(t["id"])==id)found=true;}if(!found)throw new Exception("Track does not belong to this source");}
   mpv.Cmd("set",type=="audio"?"aid":"sid",id);if(type=="subtitle"){if(id!="no")RefreshPausedSubtitles();else subtitleRefreshPending=false;}break;
  case "subtitle-add":string subtitle=Path.GetFullPath((string)value);if(!File.Exists(subtitle)||Array.IndexOf(new[]{".ass",".ssa",".srt",".vtt",".sup"},Path.GetExtension(subtitle).ToLowerInvariant())<0)throw new Exception("Authorized subtitle unavailable");mpv.Cmd("sub-add",subtitle,"select");RefreshPausedSubtitles();break;
  case "screenshot":string output=Path.GetFullPath((string)value);if(!output.EndsWith(".png",StringComparison.OrdinalIgnoreCase)||File.Exists(output)||!Directory.Exists(Path.GetDirectoryName(output)))throw new Exception("Invalid owned screenshot output");mpv.Cmd("screenshot-to-file",output,"video");break;
  case "quit":if(surface!=null&&surface.AwaitingRelease)throw new Exception("GPU readers still own the native frame");BeginInvoke(new Action(Close));break;
  default:throw new Exception("Unsupported native action");}
  return new{ok=true};
 }
 void Reply(object id,object result,string error){Console.WriteLine(json.Serialize(new{id=id,result=result,error=error}));}
 void ReadInput(){object gate=new object();try{string line;while((line=Console.ReadLine())!=null){if(line.Length>16384)throw new Exception("Native request exceeds limit");var request=json.Deserialize<Dictionary<string,object>>(line);object result=null;string error=null;bool done=false;BeginInvoke(new Action(delegate{try{result=Dispatch(request);}catch(Exception ex){error=ex.Message;}finally{lock(gate){done=true;Monitor.Pulse(gate);}}}));lock(gate){while(!done)if(!Monitor.Wait(gate,Convert.ToString(request["action"])=="screenshot"?30000:10000)&&!done)throw new TimeoutException("Native command dispatch timeout");}Reply(request["id"],result,error);if(stopping)return;}}catch(Exception ex){Console.Error.WriteLine(ex.GetType().Name);}if(!stopping)try{BeginInvoke(new Action(Close));}catch(InvalidOperationException){}}
 protected override void OnFormClosing(FormClosingEventArgs e){stopping=true;if(watchdog!=null){watchdog.Stop();watchdog.Dispose();}wake.Set();if(renderer!=null&&!renderer.Join(5000))Environment.Exit(3);if(mpv!=null)mpv.Dispose();wake.Dispose();ready.Dispose();quiesced.Dispose();base.OnFormClosing(e);}
 [STAThread]public static int Main(string[] args){try{Console.InputEncoding=new UTF8Encoding(false,true);Console.OutputEncoding=new UTF8Encoding(false);if(args.Length!=1)return 2;SetProcessDpiAwarenessContext(new IntPtr(-4));var parser=new JavaScriptSerializer();string first=Console.ReadLine();if(first==null||first.Length>16384)return 2;Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException);Application.EnableVisualStyles();Application.Run(new RenderHost(Path.GetFullPath(args[0]),parser.Deserialize<Dictionary<string,object>>(first)));return 0;}catch(Exception ex){Console.Error.WriteLine(ex.GetType().Name+": native host could not start");return 1;}}
}
