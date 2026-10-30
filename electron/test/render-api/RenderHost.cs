// Isolated M2 feasibility host. No production IPC or renderer filesystem access.
// Framework C# compiler; libmpv is dynamically loaded by verified full path.
using System;
using System.IO;
using System.Text;
using System.Drawing;
using System.Threading;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.Web.Script.Serialization;

static class Native {
 [DllImport("kernel32",CharSet=CharSet.Unicode,SetLastError=true)] public static extern IntPtr LoadLibraryEx(string path,IntPtr file,uint flags);
 [DllImport("kernel32",CharSet=CharSet.Ansi)] public static extern IntPtr GetProcAddress(IntPtr module,string name);
 [DllImport("kernel32")] public static extern bool FreeLibrary(IntPtr module);
 [StructLayout(LayoutKind.Sequential)] public struct IoCounters {public ulong readOperations,writeOperations,otherOperations,readTransferBytes,writeTransferBytes,otherTransferBytes;}
 [DllImport("kernel32",SetLastError=true)] public static extern bool GetProcessIoCounters(IntPtr process,out IoCounters counters);
 public static object ProcessIo(Process process){IoCounters counters;return GetProcessIoCounters(process.Handle,out counters)?(object)counters:null;}
 [DllImport("ntdll")] static extern int NtQueryInformationProcess(IntPtr process,int type,IntPtr buffer,uint size,out uint needed);
 [DllImport("ntdll")] static extern int NtQueryInformationThread(IntPtr thread,int type,IntPtr buffer,uint size,out uint needed);
 [DllImport("kernel32")] static extern uint GetProcessIdOfThread(IntPtr thread);
 [DllImport("ntdll")] static extern int NtQueryObject(IntPtr handle,int type,IntPtr buffer,uint size,out uint needed);
 // Own-process object TYPES only; never enumerate other processes or names/paths.
 public static object HandleTypes(){
  const int size=1024*1024;IntPtr buffer=Marshal.AllocHGlobal(size),typeBuffer=Marshal.AllocHGlobal(4096);
  try{uint needed;int status=NtQueryInformationProcess(new IntPtr(-1),51,buffer,size,out needed);if(status<0)return new{available=false,status=status};long count=Marshal.ReadInt64(buffer);if(count<0||count>(size-16)/40)throw new Exception("Handle snapshot exceeds bound");
   var counts=new System.Collections.Generic.Dictionary<string,int>();var names=new System.Collections.Generic.Dictionary<int,string>();var threadModules=new System.Collections.Generic.Dictionary<string,int>();
   for(int i=0;i<count;i++){int offset=16+i*40,index=Marshal.ReadInt32(buffer,offset+28);string name;if(!names.TryGetValue(index,out name)){name="type-"+index;IntPtr h=Marshal.ReadIntPtr(buffer,offset);if(NtQueryObject(h,2,typeBuffer,4096,out needed)>=0){int length=(ushort)Marshal.ReadInt16(typeBuffer);IntPtr text=Marshal.ReadIntPtr(typeBuffer,8);long start=typeBuffer.ToInt64(),at=text.ToInt64();if(length>0&&length<=256&&at>=start&&at+length<=start+4096)name=Marshal.PtrToStringUni(text,length/2);}names[index]=name;}int value;counts.TryGetValue(name,out value);counts[name]=value+1;if(name=="Thread"){string owner="unavailable";IntPtr h=Marshal.ReadIntPtr(buffer,offset);using(var self=Process.GetCurrentProcess()){if(GetProcessIdOfThread(h)==(uint)self.Id&&NtQueryInformationThread(h,9,typeBuffer,8,out needed)>=0){long address=Marshal.ReadIntPtr(typeBuffer).ToInt64();owner="unmapped";foreach(ProcessModule m in self.Modules){long b=m.BaseAddress.ToInt64();if(address>=b&&address<b+m.ModuleMemorySize){owner=m.ModuleName;break;}}}}int n;threadModules.TryGetValue(owner,out n);threadModules[owner]=n+1;}}
   return new{available=true,count=count,counts=counts,threadModules=threadModules};
  }finally{Marshal.FreeHGlobal(typeBuffer);Marshal.FreeHGlobal(buffer);}
 }

 [DllImport("user32")] public static extern IntPtr GetDC(IntPtr window);
 [DllImport("user32")] public static extern int ReleaseDC(IntPtr window,IntPtr dc);
 [DllImport("user32")] public static extern IntPtr SetParent(IntPtr child,IntPtr parent);
 [DllImport("user32")] public static extern IntPtr SetWindowLongPtr(IntPtr window,int index,IntPtr value);
 [DllImport("user32")] public static extern IntPtr GetWindowLongPtr(IntPtr window,int index);
 [DllImport("user32")] public static extern bool SetWindowPos(IntPtr window,IntPtr after,int x,int y,int w,int h,uint flags);
 [DllImport("user32")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
 [StructLayout(LayoutKind.Sequential)] public struct Pfd {
  public ushort size,version;public uint flags;public byte pixelType,colorBits,redBits,redShift,greenBits,greenShift,blueBits,blueShift,alphaBits,alphaShift,accumBits,accumRedBits,accumGreenBits,accumBlueBits,accumAlphaBits,depthBits,stencilBits,auxBuffers,layerType,reserved;public uint layerMask,visibleMask,damageMask;
 }
 [DllImport("gdi32")] public static extern int ChoosePixelFormat(IntPtr dc,ref Pfd pfd);
 [DllImport("gdi32")] public static extern bool SetPixelFormat(IntPtr dc,int format,ref Pfd pfd);
 [DllImport("gdi32")] public static extern bool SwapBuffers(IntPtr dc);
 [DllImport("opengl32")] public static extern IntPtr wglCreateContext(IntPtr dc);
 [DllImport("opengl32")] public static extern bool wglMakeCurrent(IntPtr dc,IntPtr context);
 [DllImport("opengl32")] public static extern bool wglDeleteContext(IntPtr context);
 [DllImport("opengl32",CharSet=CharSet.Ansi)] public static extern IntPtr wglGetProcAddress(string name);
 [DllImport("opengl32")] public static extern IntPtr glGetString(uint name);
 [DllImport("opengl32")] public static extern uint glGetError();

 [DllImport("opengl32")] public static extern void glReadPixels(int x,int y,int w,int h,uint format,uint type,[Out] byte[] pixels);
 [DllImport("opengl32",EntryPoint="glReadPixels")] public static extern void glReadPixelsFloat(int x,int y,int w,int h,uint format,uint type,[Out] float[] pixels);
}

sealed class Mpv : IDisposable {
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate IntPtr Create();
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int Initialize(IntPtr handle);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int SetOption(IntPtr handle,IntPtr name,IntPtr value);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int Command(IntPtr handle,IntPtr args);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate IntPtr GetString(IntPtr handle,IntPtr name);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate void Free(IntPtr value);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int RenderCreate(out IntPtr context,IntPtr handle,[In] Param[] args);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int Render(IntPtr context,[In] Param[] args);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate ulong Update(IntPtr context);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int GetInfo(IntPtr context,Param param);
 [StructLayout(LayoutKind.Sequential)] struct FrameInfo {public ulong flags;public long targetTime;}
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate void Wake(IntPtr opaque);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate void SetUpdate(IntPtr context,Wake callback,IntPtr opaque);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)] public delegate IntPtr GetProc(IntPtr opaque,IntPtr name);
 [StructLayout(LayoutKind.Sequential)] public struct Param {public int type;public IntPtr data;public Param(int t,IntPtr d){type=t;data=d;}}
 [StructLayout(LayoutKind.Sequential)] struct GlInit {public IntPtr getProc,opaque;}
 [StructLayout(LayoutKind.Sequential)] struct Fbo {public int id,width,height,format;}
 IntPtr module,handle,context;Initialize initialize;SetOption option;Command command;GetString get;Free free,destroy,renderFree;RenderCreate createRender;Render render;Update update;GetInfo getInfo;SetUpdate setUpdate;
 public static IntPtr Utf8(string s){var bytes=Encoding.UTF8.GetBytes(s+"\0");var p=Marshal.AllocHGlobal(bytes.Length);Marshal.Copy(bytes,0,p,bytes.Length);return p;}
 T Bind<T>(string name){var p=Native.GetProcAddress(module,name);if(p==IntPtr.Zero)throw new Exception("Missing export "+name);return (T)(object)Marshal.GetDelegateForFunctionPointer(p,typeof(T));}
 public Mpv(string path,bool floatingPoint,bool originalPixelTarget){
  module=Native.LoadLibraryEx(path,IntPtr.Zero,0x1100);if(module==IntPtr.Zero)throw new Exception("DLL load "+Marshal.GetLastWin32Error());
  handle=Bind<Create>("mpv_create")();initialize=Bind<Initialize>("mpv_initialize");option=Bind<SetOption>("mpv_set_option_string");command=Bind<Command>("mpv_command");get=Bind<GetString>("mpv_get_property_string");free=Bind<Free>("mpv_free");destroy=Bind<Free>("mpv_terminate_destroy");
  createRender=Bind<RenderCreate>("mpv_render_context_create");render=Bind<Render>("mpv_render_context_render");update=Bind<Update>("mpv_render_context_update");getInfo=Bind<GetInfo>("mpv_render_context_get_info");setUpdate=Bind<SetUpdate>("mpv_render_context_set_update_callback");renderFree=Bind<Free>("mpv_render_context_free");
  bool hdrLinear=Environment.GetEnvironmentVariable("AVHUB_RENDER_HDR_LINEAR_PROBE")=="1";bool hdrProbe=Environment.GetEnvironmentVariable("AVHUB_RENDER_HDR_PIXEL_PROBE")=="1";if(hdrProbe&&!floatingPoint)throw new Exception("HDR numerical probe requires F16");
  foreach(var pair in new[]{new[]{"config","no"},new[]{"terminal","no"},new[]{"vo","libmpv"},new[]{"hwdec",Environment.GetEnvironmentVariable("AVHUB_RENDER_SOFTWARE_DECODE")=="1"?"no":"auto-safe"},new[]{"audio","no"},new[]{"keep-open","yes"},new[]{"idle","yes"},new[]{"target-prim",hdrProbe&&!hdrLinear?"bt.2020":"bt.709"},new[]{"target-trc",hdrProbe?(hdrLinear?"scrgb":"pq"):"srgb"}})Option(pair[0],pair[1]);
  // Explicit F16 comparison is test-only. Preserve intermediate precision by
  // default for the isolated high-bit-depth candidate; no production changes.
  if(floatingPoint){Option("fbo-format",Environment.GetEnvironmentVariable("AVHUB_RENDER_INTERNAL_F16")=="1"?"rgba16f":"rgba32f");Option("dither-depth","no");}
  if(hdrProbe){Option("target-peak","10000");Option("tone-mapping","clip");Option("hdr-compute-peak","no");}
  // Shared FBO is exactly the verified source size. Avoid an unnecessary
  // convolution pass at 1:1; this does not change display-window scaling.
  if(originalPixelTarget)Option("scale",Environment.GetEnvironmentVariable("AVHUB_RENDER_TEST_NATIVE_SCALE")=="lanczos"?"lanczos":"bilinear");
  Check(initialize(handle));
 }
 static void Check(int code){if(code<0)throw new Exception("libmpv error "+code);}
 void Option(string key,string value){var k=Utf8(key);var v=Utf8(value);try{Check(option(handle,k,v));}finally{Marshal.FreeHGlobal(k);Marshal.FreeHGlobal(v);}}
 public void Cmd(params string[] args){var ps=Array.ConvertAll(args,Utf8);var list=Marshal.AllocHGlobal((ps.Length+1)*IntPtr.Size);try{Marshal.Copy(ps,0,list,ps.Length);Marshal.WriteIntPtr(list,ps.Length*IntPtr.Size,IntPtr.Zero);Check(command(handle,list));}finally{foreach(var p in ps)Marshal.FreeHGlobal(p);Marshal.FreeHGlobal(list);}}
 public string Property(string name){var key=Utf8(name);IntPtr p=IntPtr.Zero;try{p=get(handle,key);if(p==IntPtr.Zero)return null;int n=0;while(Marshal.ReadByte(p,n)!=0)n++;var bytes=new byte[n];Marshal.Copy(p,bytes,0,n);return Encoding.UTF8.GetString(bytes);}finally{Marshal.FreeHGlobal(key);if(p!=IntPtr.Zero)free(p);}}
 public void CreateRenderer(GetProc proc,Wake wake){
  var api=Utf8("opengl");var gl=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(GlInit)));
  try{Marshal.StructureToPtr(new GlInit{getProc=Marshal.GetFunctionPointerForDelegate(proc)},gl,false);Check(createRender(out context,handle,new[]{new Param(1,api),new Param(2,gl),new Param()}));setUpdate(context,wake,IntPtr.Zero);}finally{Marshal.FreeHGlobal(api);Marshal.FreeHGlobal(gl);}
 }
 public void CreateD3DRenderer(IntPtr device,Wake wake){IntPtr api=Utf8("d3d11"),init=Marshal.AllocHGlobal(IntPtr.Size);try{Marshal.WriteIntPtr(init,device);Check(createRender(out context,handle,new[]{new Param(1,api),new Param(21,init),new Param()}));setUpdate(context,wake,IntPtr.Zero);}finally{Marshal.FreeHGlobal(api);Marshal.FreeHGlobal(init);}}
 public void DrawD3D(IntPtr texture){var fbo=Marshal.AllocHGlobal(IntPtr.Size);try{Marshal.WriteIntPtr(fbo,texture);Check(render(context,new[]{new Param(22,fbo),new Param()}));}finally{Marshal.FreeHGlobal(fbo);}}
 public ulong NextFrameFlags(){var p=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(FrameInfo)));try{Marshal.StructureToPtr(new FrameInfo(),p,false);Check(getInfo(context,new Param(11,p)));return ((FrameInfo)Marshal.PtrToStructure(p,typeof(FrameInfo))).flags;}finally{Marshal.FreeHGlobal(p);}}
 public bool NeedsFrame(){return (update(context)&1)!=0;}
 public void Draw(int width,int height,int target=0,bool floatingPoint=false){var fbo=Marshal.AllocHGlobal(16);var flip=Marshal.AllocHGlobal(4);try{Marshal.StructureToPtr(new Fbo{id=target,width=width,height=height,format=floatingPoint?0x881A:0x8058},fbo,false);Marshal.WriteInt32(flip,target==0?1:0);Check(render(context,new[]{new Param(3,fbo),new Param(4,flip),new Param()}));}finally{Marshal.FreeHGlobal(fbo);Marshal.FreeHGlobal(flip);}}
 public void FreeRenderer(){if(context!=IntPtr.Zero){setUpdate(context,null,IntPtr.Zero);renderFree(context);context=IntPtr.Zero;}}
 public void Dispose(){if(handle!=IntPtr.Zero){destroy(handle);handle=IntPtr.Zero;}if(module!=IntPtr.Zero){Native.FreeLibrary(module);module=IntPtr.Zero;}}
}

sealed class RenderHost : Form {
 protected override bool ShowWithoutActivation {get{return true;}}
 protected override CreateParams CreateParams {get{var p=base.CreateParams;p.ClassStyle|=0x20;p.ExStyle|=0x08000000;return p;}}
 protected override void OnPaintBackground(PaintEventArgs e){}
 protected override void OnPaint(PaintEventArgs e){wake.Set();}
 readonly string dll,source;readonly IntPtr parent;Mpv mpv;IntPtr dc,window;Thread renderer;volatile bool stopping;volatile int width=960,height=540;readonly AutoResetEvent wake=new AutoResetEvent(false);readonly ManualResetEvent ready=new ManualResetEvent(false);string renderError,glVendor,glRenderer,pixel;long frames,scheduledFrames,redrawFrames,repeatFrames,unclassifiedFrames;int forceRedraw;uint glError;Mpv.GetProc proc;Mpv.Wake callback;IntPtr opengl;
 readonly JavaScriptSerializer json=new JavaScriptSerializer();
 bool subtitleLoaded;readonly bool sharedMode,floatingPoint;readonly int sourceWidth,sourceHeight;IRenderSurface shared;readonly bool d3dMode;volatile bool injectRenderFailure;int precisionLevels;float precisionMin,precisionMax;float[] precisionRow,precisionRgb;
 public RenderHost(string d,string s,IntPtr p,bool sharedTexture,int sw,int sh,bool fp16,bool d3d=false){d3dMode=d3d;dll=d;source=s;parent=p;sharedMode=sharedTexture;sourceWidth=sw;sourceHeight=sh;floatingPoint=fp16;if(sharedMode)Opacity=0;Text="AVHub Render API spike";FormBorderStyle=FormBorderStyle.None;ClientSize=new Size(960,540);BackColor=Color.Black;ShowInTaskbar=false;}
 protected override void OnShown(EventArgs e){base.OnShown(e);window=Handle;if(parent!=IntPtr.Zero&&!sharedMode){Native.SetParent(Handle,parent);Native.SetWindowLongPtr(Handle,-16,new IntPtr(0x56000000));Location=Point.Empty;}
  if(!d3dMode)dc=Native.GetDC(Handle);mpv=new Mpv(dll,floatingPoint,sharedMode);renderer=new Thread(RenderLoop);renderer.IsBackground=true;renderer.Start();if(!ready.WaitOne(10000)||renderError!=null)throw new Exception("Renderer initialization: "+renderError);
  mpv.Cmd("loadfile",source);if(sharedMode)Hide();var input=new Thread(ReadInput);input.IsBackground=true;input.Start();
 }
 void RenderLoop(){IntPtr context=IntPtr.Zero;try{
  callback=delegate{wake.Set();};
  if(d3dMode){var target=new D3dSurface(sourceWidth,sourceHeight,floatingPoint);shared=target;glVendor="DXGI";glRenderer=target.Description;mpv.CreateD3DRenderer(target.Device,callback);}
  else{
  var pfd=new Native.Pfd{size=(ushort)Marshal.SizeOf(typeof(Native.Pfd)),version=1,flags=0x25,pixelType=0,colorBits=32,alphaBits=8,depthBits=24};var format=Native.ChoosePixelFormat(dc,ref pfd);if(format==0||!Native.SetPixelFormat(dc,format,ref pfd))throw new Exception("Pixel format");
  context=Native.wglCreateContext(dc);if(context==IntPtr.Zero||!Native.wglMakeCurrent(dc,context))throw new Exception("WGL context");
  opengl=Native.LoadLibraryEx(Path.Combine(Environment.SystemDirectory,"opengl32.dll"),IntPtr.Zero,0x800);
  proc=delegate(IntPtr opaque,IntPtr name){string n=Marshal.PtrToStringAnsi(name);var p=Native.wglGetProcAddress(n);long v=p.ToInt64();return v==0||v==1||v==2||v==3||v==-1?Native.GetProcAddress(opengl,n):p;};
  glVendor=Marshal.PtrToStringAnsi(Native.glGetString(0x1F00));glRenderer=Marshal.PtrToStringAnsi(Native.glGetString(0x1F01));callback=delegate{wake.Set();};mpv.CreateRenderer(proc,callback);if(sharedMode)shared=new SharedSurface(proc,parent,sourceWidth,sourceHeight,floatingPoint);
  }
  ready.Set();
  int lastW=0,lastH=0;bool pending=false;while(!stopping){wake.WaitOne(100);if(injectRenderFailure)throw new Exception("Injected render-thread failure");bool changed=width!=lastW||height!=lastH;bool requestedRedraw=Interlocked.Exchange(ref forceRedraw,0)!=0;pending=mpv.NeedsFrame()||requestedRedraw||changed||pending;if(pending&&(shared==null||!shared.AwaitingRelease)){int w=shared==null?Math.Max(1,width):shared.Width,h=shared==null?Math.Max(1,height):shared.Height;if(shared!=null)shared.LockForDraw();ulong frameFlags=mpv.NextFrameFlags();if(d3dMode)mpv.DrawD3D(((D3dSurface)shared).Texture);else mpv.Draw(w,h,shared==null?0:shared.Fbo,floatingPoint);if((frameFlags&1)==0)Interlocked.Increment(ref unclassifiedFrames);else if((frameFlags&2)!=0)Interlocked.Increment(ref redrawFrames);else if((frameFlags&4)!=0)Interlocked.Increment(ref repeatFrames);else Interlocked.Increment(ref scheduledFrames);if(floatingPoint&&Interlocked.Read(ref frames)<10){shared.BindForDiagnostics();var row=shared.ReadDiagnosticRow();var unique=new System.Collections.Generic.HashSet<float>();precisionMin=float.MaxValue;precisionMax=float.MinValue;for(int i=0;i<row.Length;i+=4){unique.Add(row[i]);precisionMin=Math.Min(precisionMin,row[i]);precisionMax=Math.Max(precisionMax,row[i]);}precisionLevels=unique.Count;var red=new float[w];for(int x=0;x<w;x++)red[x]=row[x*4];precisionRow=red;var rgb=new float[w*3];for(int x=0;x<w;x++)for(int c=0;c<3;c++)rgb[x*3+c]=row[x*4+c];precisionRgb=rgb;}if(Interlocked.Read(ref frames)<10){var bytes=shared!=null?shared.ReadDiagnosticPixel():new byte[4];if(shared==null)Native.glReadPixels(w/4,h/2,1,1,0x1908,0x1401,bytes);pixel=BitConverter.ToString(bytes);glError=d3dMode?0:Native.glGetError();}if(shared!=null)shared.UnlockAfterDraw();else if(!Native.SwapBuffers(dc))throw new Exception("SwapBuffers failed");Interlocked.Increment(ref frames);lastW=width;lastH=height;pending=false;}}
 }catch(Exception ex){renderError=ex.ToString();ready.Set();}finally{if(mpv!=null)mpv.FreeRenderer();if(shared!=null)shared.Dispose();if(!d3dMode)Native.wglMakeCurrent(IntPtr.Zero,IntPtr.Zero);if(context!=IntPtr.Zero)Native.wglDeleteContext(context);if(opengl!=IntPtr.Zero)Native.FreeLibrary(opengl);}}
 void ReadInput(){object sharedCompletionGate=new object();bool perCommandGate=Environment.GetEnvironmentVariable("AVHUB_RENDER_TEST_PER_COMMAND_GATE")=="1";try{string line;while((line=Console.ReadLine())!=null){if(line.Length>4096)throw new Exception("Request too large");var request=json.Deserialize<System.Collections.Generic.Dictionary<string,object>>(line);object response=null;Exception error=null;object completionGate=perCommandGate?new object():sharedCompletionGate;bool completed=false;BeginInvoke(new Action(delegate{try{response=Dispatch(request);}catch(Exception ex){error=ex;}finally{lock(completionGate){completed=true;Monitor.Pulse(completionGate);}}}));lock(completionGate){while(!completed){if(!Monitor.Wait(completionGate,10000)&&!completed)throw new TimeoutException("UI command dispatch timeout");}}Console.WriteLine(json.Serialize(new{id=request["id"],result=response,error=error==null?null:error.Message}));if(stopping)return;}}catch(Exception ex){Console.Error.WriteLine(ex.Message);}if(!stopping)BeginInvoke(new Action(Close));}
 object Dispatch(System.Collections.Generic.Dictionary<string,object> r){string action=(string)r["action"];switch(action){
  case "subtitle-probe":string subtitle=Environment.GetEnvironmentVariable("AVHUB_RENDER_OVERLAY_FILE");if(string.IsNullOrEmpty(subtitle)||!File.Exists(subtitle))throw new Exception("Overlay probe disabled");if(!subtitleLoaded){mpv.Cmd("sub-add",subtitle,"select");subtitleLoaded=true;}mpv.Cmd("set","sub-visibility",Convert.ToBoolean(r["value"])?"yes":"no");break;
  case "osd-probe":if(string.IsNullOrEmpty(Environment.GetEnvironmentVariable("AVHUB_RENDER_OVERLAY_FILE")))throw new Exception("Overlay probe disabled");mpv.Cmd("set","osd-align-x","center");mpv.Cmd("set","osd-align-y","center");mpv.Cmd("show-text",Convert.ToBoolean(r["value"])?"AVHub native OSD":"","60000");break;
  case "soak-loop":mpv.Cmd("set","loop-file",Convert.ToBoolean(r["value"])?"inf":"no");break;
  case "handle-types":return Native.HandleTypes();
  case "ping":break;
  case "redraw":Interlocked.Exchange(ref forceRedraw,1);wake.Set();break;
  case "render-options":return new{ditherDepth=mpv.Property("options/dither-depth"),dither=mpv.Property("options/dither"),deband=mpv.Property("options/deband"),scale=mpv.Property("options/scale"),resizesOnly=mpv.Property("options/scaler-resizes-only"),unscaled=mpv.Property("options/video-unscaled"),outWidth=mpv.Property("video-out-params/dw"),outHeight=mpv.Property("video-out-params/dh"),framebuffer=mpv.Property("osd-dimensions"),videoParams=mpv.Property("video-params")};
  case "precision-row":return new{values=precisionRow,rgb=precisionRgb};
  case "display":return DisplayProbe.Read(parent);
  case "snapshot":return new{renderApi=d3dMode?"d3d11":"opengl",frames=Interlocked.Read(ref frames),scheduledFrames=Interlocked.Read(ref scheduledFrames),redrawFrames=Interlocked.Read(ref redrawFrames),repeatFrames=Interlocked.Read(ref repeatFrames),unclassifiedFrames=Interlocked.Read(ref unclassifiedFrames),voDrops=mpv.Property("frame-drop-count"),voDelayed=mpv.Property("vo-delayed-frame-count"),estimatedVfFps=mpv.Property("estimated-vf-fps"),framedropMode=mpv.Property("options/framedrop"),loop=mpv.Property("loop-file"),time=mpv.Property("time-pos"),pause=mpv.Property("pause"),subtitleText=mpv.Property("sub-text"),subtitleVisible=mpv.Property("sub-visibility"),width=mpv.Property("width"),height=mpv.Property("height"),hwdec=mpv.Property("hwdec-current"),vo=mpv.Property("current-vo"),version=mpv.Property("mpv-version"),drops=mpv.Property("decoder-frame-drop-count"),sourcePrimaries=mpv.Property("video-params/primaries"),sourceTransfer=mpv.Property("video-params/gamma"),sourceMatrix=mpv.Property("video-params/colormatrix"),sourcePixelFormat=mpv.Property("video-params/pixelformat"),outputTransfer=mpv.Property("options/target-trc"),internalFbo=mpv.Property("options/fbo-format"),glVendor=glVendor,glRenderer=glRenderer,pixel=pixel,glError=glError,renderError=renderError,precisionLevels=precisionLevels,precisionMin=precisionMin,precisionMax=precisionMax,shared=shared==null?null:new{handleOwner="native-source",handle=shared.Handle,frame=shared.Frame,width=shared.Width,height=shared.Height,pixelFormat=shared.FloatingPoint?"rgbaf16":"rgba",redBits=shared.RedBits,glDeviceLuid=shared.GlDeviceLuid,adapterLuid=shared.AdapterLuid,adapterMatch=shared.AdapterMatch,waiting=shared.AwaitingRelease}};
  case "ack":if(shared!=null&&Convert.ToInt64(r["value"])==shared.Frame){shared.AwaitingRelease=false;wake.Set();}break;
  case "inject-render-error":injectRenderFailure=true;wake.Set();break;
  case "resources":using(var process=Process.GetCurrentProcess()){return new{handles=process.HandleCount,cpuTimeMs=process.TotalProcessorTime.TotalMilliseconds,processIoIncludingPipes=Native.ProcessIo(process),workingSetBytes=process.WorkingSet64,privateBytes=process.PrivateMemorySize64,textureBudgetBytes=(long)sourceWidth*sourceHeight*(floatingPoint?8:4)*3,gpuMemory=shared==null||!floatingPoint?null:(object)shared.CheckBudget(false)};}
  case "pause":mpv.Cmd("set","pause",Convert.ToBoolean(r["value"])?"yes":"no");break;
  case "place":Native.SetWindowPos(Handle,new IntPtr(-1),Convert.ToInt32(r["x"]),Convert.ToInt32(r["y"]),Convert.ToInt32(r["width"]),Convert.ToInt32(r["height"]),0x50);break;
  case "seek":double pos=Convert.ToDouble(r["value"]);if(double.IsNaN(pos)||double.IsInfinity(pos)||pos<0||pos>86400)throw new Exception("Invalid seek");mpv.Cmd("seek",pos.ToString(System.Globalization.CultureInfo.InvariantCulture),"absolute+exact");break;
  case "resize":int w=Convert.ToInt32(r["width"]),h=Convert.ToInt32(r["height"]);if(w<1||w>16384||h<1||h>16384)throw new Exception("Invalid size");ClientSize=new Size(w,h);Native.SetWindowPos(Handle,IntPtr.Zero,0,0,w,h,0x50);width=w;height=h;wake.Set();break;
  case "quit":BeginInvoke(new Action(Close));break;
  default:throw new Exception("Unsupported action");
 }return new{ok=true};}
 protected override void OnFormClosing(FormClosingEventArgs e){var clock=System.Diagnostics.Stopwatch.StartNew();stopping=true;wake.Set();Console.Error.WriteLine("shutdown begin");if(renderer!=null&&!renderer.Join(5000)){Console.Error.WriteLine("shutdown render join timeout");Environment.Exit(3);}Console.Error.WriteLine("shutdown renderer released ms="+clock.ElapsedMilliseconds);if(mpv!=null)mpv.Dispose();Console.Error.WriteLine("shutdown mpv released ms="+clock.ElapsedMilliseconds);if(dc!=IntPtr.Zero)Native.ReleaseDC(window,dc);base.OnFormClosing(e);}
 [STAThread] public static int Main(string[] args){try{bool shared=(args.Length==6||args.Length==7)&&(args[3]=="shared"||args[3]=="shared-d3d11"),fp16=args.Length==7&&args[6]=="rgba16f";if(args.Length!=3&&!shared||args.Length==7&&!fp16)return 2;Native.SetProcessDpiAwarenessContext(new IntPtr(-4));Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException);Application.EnableVisualStyles();Application.Run(new RenderHost(Path.GetFullPath(args[0]),Path.GetFullPath(args[1]),new IntPtr(long.Parse(args[2])),shared,shared?int.Parse(args[4]):0,shared?int.Parse(args[5]):0,fp16,shared&&args[3]=="shared-d3d11"));return 0;}catch(Exception ex){Console.Error.WriteLine(ex);return 1;}}
}
