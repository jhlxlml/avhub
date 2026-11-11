using System;using System.IO;using System.Text;using System.Runtime.InteropServices;using System.Collections.Generic;using System.Security.Cryptography;

// All normal client API calls belong to the WinForms control thread. Only the
// Render API is called on the dedicated D3D thread (libmpv's threading contract).
sealed class MpvCore : IDisposable {
 const string SelfBuiltDllHash="2cf60d001765b91cf3f40a7ef115da010385ecc46442d609d8a75d3db3defa88";
 const string MkvIndexDllHash="5b45550f85ace0822f14d17deb7777c76d229e33c572f94a2f66580e631b42b1";
 const string ReplayedDllHash="ee574a3359daa225e63e858faf48e5c3c9be46ddcd552b6781b04992f89d5880";
 const string DllHash="ea82215b32d8e5c8ed8e41b97659a5bf7c0ed0d1861d1baa61e6a6500a8ffe74";
 [DllImport("kernel32",CharSet=CharSet.Unicode,SetLastError=true)]static extern IntPtr LoadLibraryEx(string path,IntPtr file,uint flags);
 [DllImport("kernel32",CharSet=CharSet.Ansi)]static extern IntPtr GetProcAddress(IntPtr module,string name);
 [DllImport("kernel32")]static extern bool FreeLibrary(IntPtr module);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)]delegate IntPtr Create();
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)]delegate int Initialize(IntPtr handle);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)]delegate int SetOption(IntPtr handle,IntPtr name,IntPtr value);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)]delegate int Command(IntPtr handle,IntPtr args);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)]delegate int CommandAsync(IntPtr handle,ulong userdata,IntPtr args);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)]delegate int GetProperty(IntPtr handle,IntPtr name,int format,ref Node value);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)]delegate void FreeNode(ref Node value);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)]delegate void Destroy(IntPtr handle);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)]delegate int RequestLog(IntPtr handle,IntPtr level);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)]delegate int ObserveProperty(IntPtr handle,ulong userdata,IntPtr name,int format);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)]delegate IntPtr WaitEvent(IntPtr handle,double timeout);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)]delegate int RenderCreate(out IntPtr context,IntPtr handle,[In] Param[] args);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)]delegate int Render(IntPtr context,[In] Param[] args);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)]delegate ulong Update(IntPtr context);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)]delegate int GetInfo(IntPtr context,Param param);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)]delegate void SetUpdate(IntPtr context,Wake callback,IntPtr opaque);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)]public delegate void Wake(IntPtr opaque);
 [StructLayout(LayoutKind.Sequential)]struct Param {public int type;public IntPtr data;public Param(int t,IntPtr d){type=t;data=d;}}
 [StructLayout(LayoutKind.Explicit,Size=16)]struct Node {[FieldOffset(0)]public IntPtr pointer;[FieldOffset(0)]public int flag;[FieldOffset(0)]public long integer;[FieldOffset(0)]public double number;[FieldOffset(8)]public int format;}
 [StructLayout(LayoutKind.Sequential)]struct NodeList {public int count;public IntPtr values,keys;}
 [StructLayout(LayoutKind.Sequential)]struct Event {public int id,error;public ulong userdata;public IntPtr data;}
 [StructLayout(LayoutKind.Sequential)]struct FrameInfo {public ulong flags;public long targetTime;}
 [StructLayout(LayoutKind.Sequential)]struct PropertyEvent {public IntPtr name;public int format;public IntPtr data;}
 [StructLayout(LayoutKind.Sequential)]struct LogMessage {public IntPtr prefix,level,text;public int logLevel;}
 public sealed class PlayerEvent {public int id,error,reason;public ulong userdata;public bool? cachePaused;public string propertyName;public object propertyValue;}
 readonly bool trace=Environment.GetEnvironmentVariable("AVHUB_NATIVE_SEEK_TRACE")=="1";
 readonly System.Collections.Concurrent.ConcurrentQueue<object> traceCalls=new System.Collections.Concurrent.ConcurrentQueue<object>();
 public void ResetTrace(){object item;while(traceCalls.TryDequeue(out item)){}}
 public object Trace(){return trace?traceCalls.ToArray():null;}
 void AddTrace(string name,double ms){traceCalls.Enqueue(new{name,ms});object old;while(traceCalls.Count>64)traceCalls.TryDequeue(out old);}
 void Record(string name,long began){if(!trace)return;double ms=(System.Diagnostics.Stopwatch.GetTimestamp()-began)*1000.0/System.Diagnostics.Stopwatch.Frequency;if(ms>=20)AddTrace(name,ms);}
 // Snapshot metadata is delivered by the core's property events. Repeated
 // synchronous getters can wait for the VO while it needs our next draw.
 // RenderHost still reads pause/time-pos fresh at control/seek boundaries.
 readonly string[] observedFrameProperties={"video-params","time-pos","seeking","pause","container-fps","duration","volume","mute","speed","eof-reached","track-list","aid","sid","sub-delay","sub-text","video-out-params","audio-params","audio-out-params","current-ao","current-demuxer","avsync","hwdec-current","decoder-frame-drop-count","frame-drop-count"};
 IntPtr module,handle,context;SetOption option;Command command;CommandAsync commandAsync;GetProperty get;FreeNode freeNode;Destroy destroy,renderFree;WaitEvent wait;RenderCreate createRender;Render render;Update update;GetInfo getInfo;SetUpdate setUpdate;
 T Bind<T>(string name){var p=GetProcAddress(module,name);if(p==IntPtr.Zero)throw new Exception("Missing native API: "+name);return (T)(object)Marshal.GetDelegateForFunctionPointer(p,typeof(T));}
 static IntPtr Utf8(string s){var bytes=Encoding.UTF8.GetBytes(s+"\0");var p=Marshal.AllocHGlobal(bytes.Length);Marshal.Copy(bytes,0,p,bytes.Length);return p;}
 static string Text(IntPtr p){if(p==IntPtr.Zero)return null;int n=0;while(n<262144&&Marshal.ReadByte(p,n)!=0)n++;if(n==262144)throw new Exception("Native text exceeds limit");var bytes=new byte[n];Marshal.Copy(p,bytes,0,n);return Encoding.UTF8.GetString(bytes);}
 static void Check(int code){if(code<0)throw new Exception("libmpv error "+code);}
 public readonly Dictionary<string,double> StartupMs=new Dictionary<string,double>();
 public MpvCore(string dll,bool floatingPoint,string shaderCache=null){
  var startup=System.Diagnostics.Stopwatch.StartNew();
  bool scriptingCompiledOut=false;
  try{
   using(var sha=SHA256.Create())using(var f=File.OpenRead(dll)){var actual=BitConverter.ToString(sha.ComputeHash(f)).Replace("-","").ToLowerInvariant();scriptingCompiledOut=actual==SelfBuiltDllHash||actual==ReplayedDllHash||actual==MkvIndexDllHash;if(actual!=DllHash&&!scriptingCompiledOut)throw new Exception("Untrusted libmpv runtime");}
   StartupMs["dllHashMs"]=startup.Elapsed.TotalMilliseconds;startup.Restart();
   module=LoadLibraryEx(Path.GetFullPath(dll),IntPtr.Zero,0x1100);if(module==IntPtr.Zero)throw new Exception("Native runtime load failed: "+Marshal.GetLastWin32Error());
   StartupMs["loadLibraryMs"]=startup.Elapsed.TotalMilliseconds;startup.Restart();
   handle=Bind<Create>("mpv_create")();if(handle==IntPtr.Zero)throw new Exception("mpv_create failed");destroy=Bind<Destroy>("mpv_terminate_destroy");
   option=Bind<SetOption>("mpv_set_option_string");command=Bind<Command>("mpv_command");commandAsync=Bind<CommandAsync>("mpv_command_async");get=Bind<GetProperty>("mpv_get_property");freeNode=Bind<FreeNode>("mpv_free_node_contents");wait=Bind<WaitEvent>("mpv_wait_event");
   createRender=Bind<RenderCreate>("mpv_render_context_create");render=Bind<Render>("mpv_render_context_render");update=Bind<Update>("mpv_render_context_update");getInfo=Bind<GetInfo>("mpv_render_context_get_info");setUpdate=Bind<SetUpdate>("mpv_render_context_set_update_callback");renderFree=Bind<Destroy>("mpv_render_context_free");
   if(!scriptingCompiledOut){Option("load-scripts","no");Option("ytdl","no");}
   foreach(var pair in new[]{new[]{"config","no"},new[]{"terminal","no"},new[]{"vo","libmpv"},new[]{"hwdec","auto-safe"},new[]{"audio","auto"},new[]{"sub-auto","no"},new[]{"audio-file-auto","no"},new[]{"keep-open","yes"},new[]{"idle","yes"},new[]{"target-prim","bt.709"},new[]{"target-trc","srgb"},new[]{"scale","bilinear"},new[]{"pause","yes"}})Option(pair[0],pair[1]);
   if(shaderCache!=null)Option("gpu-shader-cache-dir",shaderCache);
   Option("cache","yes");Option("demuxer-max-bytes","96MiB");Option("demuxer-max-back-bytes","32MiB");
   Option("access-references","no");Option("load-unsafe-playlists","no");Option("demuxer-lavf-o","protocol_whitelist=file");
   if(floatingPoint){Option("fbo-format","rgba32f");Option("dither-depth","no");}
   StartupMs["apiOptionsMs"]=startup.Elapsed.TotalMilliseconds;startup.Restart();
   Check(Bind<Initialize>("mpv_initialize")(handle));
   StartupMs["initializeMs"]=startup.Elapsed.TotalMilliseconds;startup.Restart();
   if(trace){var level=Utf8("v");try{Check(Bind<RequestLog>("mpv_request_log_messages")(handle,level));}finally{Marshal.FreeHGlobal(level);}}
   var cacheProperty=Utf8("paused-for-cache");
   try{Check(Bind<ObserveProperty>("mpv_observe_property")(handle,1,cacheProperty,3));}finally{Marshal.FreeHGlobal(cacheProperty);}
   for(int i=0;i<observedFrameProperties.Length;i++){
    var name=Utf8(observedFrameProperties[i]);try{Check(Bind<ObserveProperty>("mpv_observe_property")(handle,(ulong)(i+2),name,6));}finally{Marshal.FreeHGlobal(name);}
   }
   StartupMs["observeMs"]=startup.Elapsed.TotalMilliseconds;
  }catch{Dispose();throw;}
 }
 public void Option(string name,string value){var k=Utf8(name);var v=Utf8(value);try{Check(option(handle,k,v));}finally{Marshal.FreeHGlobal(k);Marshal.FreeHGlobal(v);}}
 public void Cmd(params string[] args){long began=trace?System.Diagnostics.Stopwatch.GetTimestamp():0;var pointers=Array.ConvertAll(args,Utf8);var list=Marshal.AllocHGlobal((pointers.Length+1)*IntPtr.Size);try{Marshal.Copy(pointers,0,list,pointers.Length);Marshal.WriteIntPtr(list,pointers.Length*IntPtr.Size,IntPtr.Zero);Check(command(handle,list));}finally{foreach(var p in pointers)Marshal.FreeHGlobal(p);Marshal.FreeHGlobal(list);Record("command:"+args[0],began);}}
 public void CmdAsync(ulong userdata,params string[] args){long began=trace?System.Diagnostics.Stopwatch.GetTimestamp():0;var pointers=Array.ConvertAll(args,Utf8);var list=Marshal.AllocHGlobal((pointers.Length+1)*IntPtr.Size);try{Marshal.Copy(pointers,0,list,pointers.Length);Marshal.WriteIntPtr(list,pointers.Length*IntPtr.Size,IntPtr.Zero);Check(commandAsync(handle,userdata,list));}finally{foreach(var p in pointers)Marshal.FreeHGlobal(p);Marshal.FreeHGlobal(list);Record("async-command:"+args[0],began);}}
 public object Property(string name){long began=trace?System.Diagnostics.Stopwatch.GetTimestamp():0;var key=Utf8(name);var node=new Node();try{if(get(handle,key,6,ref node)<0)return null;int remaining=8192;return Read(node,0,ref remaining);}finally{Marshal.FreeHGlobal(key);freeNode(ref node);Record("property:"+name,began);}}
 static object Read(Node n,int depth,ref int remaining){if(depth>12||--remaining<0)throw new Exception("Native property exceeds bound");switch(n.format){case 0:return null;case 1:return Text(n.pointer);case 3:return n.flag!=0;case 4:return n.integer;case 5:return double.IsNaN(n.number)||double.IsInfinity(n.number)?null:(object)n.number;case 7:case 8:
   var list=(NodeList)Marshal.PtrToStructure(n.pointer,typeof(NodeList));if(list.count<0||list.count>remaining)throw new Exception("Native list exceeds bound");
   var values=new object[list.count];for(int i=0;i<values.Length;i++)values[i]=Read((Node)Marshal.PtrToStructure(IntPtr.Add(list.values,i*16),typeof(Node)),depth+1,ref remaining);
   if(n.format==7)return values;var map=new Dictionary<string,object>();for(int i=0;i<values.Length;i++)map.Add(Text(Marshal.ReadIntPtr(list.keys,i*IntPtr.Size)),values[i]);return map;
   default:throw new Exception("Unsupported native property format");}}
 public PlayerEvent NextEvent(){
  var p=wait(handle,0);var e=(Event)Marshal.PtrToStructure(p,typeof(Event));
  var result=new PlayerEvent{id=e.id,error=e.error,userdata=e.userdata};
  if(e.id==7&&e.data!=IntPtr.Zero){
   result.reason=Marshal.ReadInt32(e.data);result.error=Marshal.ReadInt32(e.data,4);
  }
  if(e.id==22&&e.userdata==1&&e.data!=IntPtr.Zero){
   var change=(PropertyEvent)Marshal.PtrToStructure(e.data,typeof(PropertyEvent));
   result.cachePaused=change.format==3&&change.data!=IntPtr.Zero&&Marshal.ReadInt32(change.data)!=0;
  }
  if(e.id==22&&e.userdata>=2&&e.userdata<(ulong)(observedFrameProperties.Length+2)&&e.data!=IntPtr.Zero){
   var change=(PropertyEvent)Marshal.PtrToStructure(e.data,typeof(PropertyEvent));
   result.propertyName=observedFrameProperties[(int)e.userdata-2];
   // Event storage belongs to libmpv until the next wait call. Read copies
   // bounded managed values here, without freeing the borrowed event node.
   if(change.format==6&&change.data!=IntPtr.Zero){
    int remaining=8192;result.propertyValue=Read((Node)Marshal.PtrToStructure(change.data,typeof(Node)),0,ref remaining);
   }
  }
  if(trace&&e.id==16&&e.data!=IntPtr.Zero){
   var log=(LogMessage)Marshal.PtrToStructure(e.data,typeof(LogMessage));string message=Text(log.text);
   if(message!=null&&(message.Contains("mpv_render_context_render() not being called")||message.Contains("mpv_render_report_swap() not being called")))
    AddTrace("libmpv-render-timeout",200);
  }
  return result;
 }
 public void CreateRenderer(IntPtr device,Wake wake){IntPtr api=Utf8("d3d11"),init=Marshal.AllocHGlobal(IntPtr.Size);try{Marshal.WriteIntPtr(init,device);Check(createRender(out context,handle,new[]{new Param(1,api),new Param(21,init),new Param()}));setUpdate(context,wake,IntPtr.Zero);}finally{Marshal.FreeHGlobal(api);Marshal.FreeHGlobal(init);}}
 public bool NeedsFrame(){return (update(context)&1)!=0;}
 public ulong FrameFlags(){var p=Marshal.AllocHGlobal(Marshal.SizeOf(typeof(FrameInfo)));try{Marshal.StructureToPtr(new FrameInfo(),p,false);Check(getInfo(context,new Param(11,p)));return ((FrameInfo)Marshal.PtrToStructure(p,typeof(FrameInfo))).flags;}finally{Marshal.FreeHGlobal(p);}}
 public void Draw(IntPtr texture){long began=trace?System.Diagnostics.Stopwatch.GetTimestamp():0;var target=Marshal.AllocHGlobal(IntPtr.Size);try{Marshal.WriteIntPtr(target,texture);Check(render(context,new[]{new Param(22,target),new Param()}));}finally{Marshal.FreeHGlobal(target);Record("render",began);}}
 public void FreeRenderer(){if(context!=IntPtr.Zero){setUpdate(context,null,IntPtr.Zero);renderFree(context);context=IntPtr.Zero;}}
 public void Dispose(){if(handle!=IntPtr.Zero&&destroy!=null){destroy(handle);handle=IntPtr.Zero;}if(module!=IntPtr.Zero){FreeLibrary(module);module=IntPtr.Zero;}}
}
