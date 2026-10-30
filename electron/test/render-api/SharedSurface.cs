// M2 SDR-only GPU interoperability experiment, not a production HDR pipeline.
using System;
using System.Runtime.InteropServices;

sealed class SharedSurface : IRenderSurface {
 [DllImport("d3d11.dll")] static extern int D3D11CreateDevice(IntPtr adapter,int type,IntPtr software,uint flags,IntPtr levels,uint count,uint sdk,out IntPtr device,out uint level,out IntPtr context);
 [DllImport("dxgi.dll")] static extern int CreateDXGIFactory1(ref Guid id,out IntPtr factory);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int TextureCreate(IntPtr self,ref Desc desc,IntPtr data,out IntPtr texture);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int Query(IntPtr self,ref Guid id,out IntPtr value);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int Share(IntPtr self,IntPtr attributes,uint access,IntPtr name,out IntPtr handle);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int EnumAdapter(IntPtr self,uint index,out IntPtr adapter);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int AdapterDesc(IntPtr self,IntPtr desc);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetAdapter(IntPtr self,out IntPtr adapter);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int MemoryQuery(IntPtr self,uint node,uint segment,out MemoryInfo info);
 [StructLayout(LayoutKind.Sequential)] public struct MemoryInfo {public ulong Budget,CurrentUsage,AvailableForReservation,CurrentReservation;}
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate void Copy(IntPtr self,IntPtr destination,IntPtr source);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate void EndQuery(IntPtr self,IntPtr query);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int QueryCreate(IntPtr self,ref QueryDesc desc,out IntPtr query);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int QueryData(IntPtr self,IntPtr query,IntPtr data,uint size,uint flags);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate void Flush(IntPtr self);
 [StructLayout(LayoutKind.Sequential)] struct QueryDesc {public uint type,misc;}
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate IntPtr OpenDevice(IntPtr device);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate bool CloseDevice(IntPtr device);
 [UnmanagedFunctionPointer(CallingConvention.StdCall,SetLastError=true)] delegate IntPtr Register(IntPtr device,IntPtr resource,uint name,uint type,uint access);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate bool Unregister(IntPtr device,IntPtr resource);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate bool Lock(IntPtr device,int count,[In] IntPtr[] objects);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate void Gen(int count,out uint name);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate void Bind(uint target,uint name);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate void Attach(uint target,uint attachment,uint type,uint texture,int level);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate uint Status(uint target);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate void AttachmentInfo(uint target,uint attachment,uint name,out int value);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate void Finish();
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate void GetBytes(uint name,[Out] byte[] data);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate void Delete(int count,ref uint name);
 [StructLayout(LayoutKind.Sequential)] struct Desc {public uint width,height,mips,array,format,sampleCount,sampleQuality,usage,bind,cpu,misc;}
 IntPtr device,context,texture,exportTexture,query,resource,interop,registered,localShare;uint tex,fbo;bool disposed,gpuLocked;Lock lockObjects,unlockObjects;Unregister unregister;CloseDevice close;Bind bindFbo;Finish finish;Delete deleteTextures,deleteFbos;
 // Source-process handle only. The trusted parent duplicates and owns its lease.
 public long Frame;public volatile bool AwaitingRelease;public readonly int Width,Height,RedBits;public readonly bool FloatingPoint;public string Handle {get{return localShare.ToInt64().ToString();}}public int Fbo {get{return (int)fbo;}}
 public readonly string GlDeviceLuid,AdapterLuid,AdapterMatch;
 long IRenderSurface.Frame {get{return Frame;}}bool IRenderSurface.AwaitingRelease {get{return AwaitingRelease;}set{AwaitingRelease=value;}}
 int IRenderSurface.Width {get{return Width;}}int IRenderSurface.Height {get{return Height;}}int IRenderSurface.RedBits {get{return RedBits;}}bool IRenderSurface.FloatingPoint {get{return FloatingPoint;}}
 string IRenderSurface.GlDeviceLuid {get{return GlDeviceLuid;}}string IRenderSurface.AdapterLuid {get{return AdapterLuid;}}string IRenderSurface.AdapterMatch {get{return AdapterMatch;}}
 public float[] ReadDiagnosticRow(){var row=new float[Width*4];Native.glReadPixelsFloat(0,Height/2,Width,1,0x1908,0x1406,row);return row;}
 public byte[] ReadDiagnosticPixel(){var bytes=new byte[4];Native.glReadPixels(Width/4,Height/2,1,1,0x1908,0x1401,bytes);return bytes;}
 T Fn<T>(Mpv.GetProc proc,string name){var s=Mpv.Utf8(name);try{var p=proc(IntPtr.Zero,s);if(p==IntPtr.Zero)throw new Exception("Missing GPU interop "+name);return (T)(object)Marshal.GetDelegateForFunctionPointer(p,typeof(T));}finally{Marshal.FreeHGlobal(s);}}
 T Com<T>(IntPtr obj,int index){return (T)(object)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(Marshal.ReadIntPtr(obj),index*IntPtr.Size),typeof(T));}
 static void Hr(int value,string stage){if(value<0)throw new Exception(stage+" HRESULT 0x"+value.ToString("X8"));}
 public SharedSurface(Mpv.GetProc proc,IntPtr parent,int width,int height,bool floatingPoint){
  if(width<16||height<16||width>8192||height>8192||(long)width*height*(floatingPoint?8:4)*3>(floatingPoint?256L:128L)*1024*1024)throw new Exception("Original dimensions exceed texture budget; no downscale fallback");Width=width;Height=height;FloatingPoint=floatingPoint;
  try{
  IntPtr factory,adapter=IntPtr.Zero;var factoryId=new Guid("770aae78-f26f-4dba-a829-253c83d1b387");Hr(CreateDXGIFactory1(ref factoryId,out factory),"CreateDXGIFactory1");
  string vendor=Marshal.PtrToStringAnsi(Native.glGetString(0x1F00));int wanted=vendor.Contains("NVIDIA")?0x10de:vendor.Contains("Intel")?0x8086:vendor.Contains("ATI")||vendor.Contains("AMD")?0x1002:0;
  try{
   long? glLuid=null;string extensions=" "+Marshal.PtrToStringAnsi(Native.glGetString(0x1F03))+" ";
   if(extensions.Contains(" GL_EXT_memory_object_win32 ")||extensions.Contains(" GL_EXT_semaphore_win32 ")){var bytes=new byte[8];Fn<GetBytes>(proc,"glGetUnsignedBytevEXT")(0x9599,bytes);if(Native.glGetError()!=0||BitConverter.ToInt64(bytes,0)==0)throw new Exception("Invalid GL device LUID query");glLuid=BitConverter.ToInt64(bytes,0);GlDeviceLuid=glLuid.Value.ToString("X16");}
   if(wanted==0&&!glLuid.HasValue)throw new Exception("Unverified GL vendor "+vendor);int matches=0;bool enumerationComplete=false;for(uint index=0;index<16;index++){IntPtr candidate;int enumerationStatus=Com<EnumAdapter>(factory,12)(factory,index,out candidate);if(enumerationStatus==unchecked((int)0x887A0002)){enumerationComplete=true;break;}Hr(enumerationStatus,"EnumAdapters1");var descBuffer=Marshal.AllocHGlobal(512);try{Hr(Com<AdapterDesc>(candidate,10)(candidate,descBuffer),"GetAdapterDesc1");long luid=Marshal.ReadInt64(descBuffer,296);bool matching=glLuid.HasValue?luid==glLuid.Value:Marshal.ReadInt32(descBuffer,256)==wanted;if(matching){matches++;if(adapter==IntPtr.Zero){AdapterLuid=luid.ToString("X16");AdapterMatch=glLuid.HasValue?"exact-gl-device-luid":"unique-vendor-only";adapter=candidate;candidate=IntPtr.Zero;}}}finally{Marshal.FreeHGlobal(descBuffer);if(candidate!=IntPtr.Zero)Marshal.Release(candidate);}}if(!enumerationComplete)throw new Exception("Adapter enumeration exceeds bounded capacity");if(matches>1)throw new Exception("Ambiguous adapters; exact unique LUID selection required");
   if(adapter==IntPtr.Zero)throw new Exception("No D3D11 adapter matching GL vendor "+vendor);uint level;Hr(D3D11CreateDevice(adapter,0,IntPtr.Zero,0x20,IntPtr.Zero,0,7,out device,out level,out context),"CreateDevice");
  }finally{if(adapter!=IntPtr.Zero)Marshal.Release(adapter);Marshal.Release(factory);}
  if(floatingPoint)CheckBudget(true);
  var desc=new Desc{width=(uint)Width,height=(uint)Height,mips=1,array=1,format=floatingPoint?10U:28U,sampleCount=1,bind=0x28,misc=0};
  Hr(Com<TextureCreate>(device,5)(device,ref desc,IntPtr.Zero,out texture),"CreateTexture2D");
  desc.misc=0x802;Hr(Com<TextureCreate>(device,5)(device,ref desc,IntPtr.Zero,out exportTexture),"CreateExportTexture2D");var queryDesc=new QueryDesc();Hr(Com<QueryCreate>(device,24)(device,ref queryDesc,out query),"CreateQuery");
  var id=new Guid("30961379-4609-4a41-998e-54fe567ee0c1");Hr(Com<Query>(exportTexture,0)(exportTexture,ref id,out resource),"QueryResource1");Hr(Com<Share>(resource,13)(resource,IntPtr.Zero,0x80000001,IntPtr.Zero,out localShare),"CreateSharedHandle");
  close=Fn<CloseDevice>(proc,"wglDXCloseDeviceNV");unregister=Fn<Unregister>(proc,"wglDXUnregisterObjectNV");deleteTextures=Fn<Delete>(proc,"glDeleteTextures");deleteFbos=Fn<Delete>(proc,"glDeleteFramebuffers");
  interop=Fn<OpenDevice>(proc,"wglDXOpenDeviceNV")(device);if(interop==IntPtr.Zero)throw new Exception("wglDXOpenDeviceNV failed");
  Fn<Gen>(proc,"glGenTextures")(1,out tex);Fn<Bind>(proc,"glBindTexture")(0x0DE1,tex);registered=Fn<Register>(proc,"wglDXRegisterObjectNV")(interop,texture,tex,0x0DE1,2);if(registered==IntPtr.Zero)throw new Exception("wglDXRegisterObjectNV failed Win32="+Marshal.GetLastWin32Error()+" GL="+Native.glGetError());
  lockObjects=Fn<Lock>(proc,"wglDXLockObjectsNV");unlockObjects=Fn<Lock>(proc,"wglDXUnlockObjectsNV");unregister=Fn<Unregister>(proc,"wglDXUnregisterObjectNV");close=Fn<CloseDevice>(proc,"wglDXCloseDeviceNV");
  Fn<Gen>(proc,"glGenFramebuffers")(1,out fbo);bindFbo=Fn<Bind>(proc,"glBindFramebuffer");finish=Fn<Finish>(proc,"glFinish");deleteTextures=Fn<Delete>(proc,"glDeleteTextures");deleteFbos=Fn<Delete>(proc,"glDeleteFramebuffers");
  LockForDraw();bindFbo(0x8D40,fbo);Fn<Attach>(proc,"glFramebufferTexture2D")(0x8D40,0x8CE0,0x0DE1,tex,0);if(Fn<Status>(proc,"glCheckFramebufferStatus")(0x8D40)!=0x8CD5)throw new Exception("Incomplete shared FBO");int bits;Fn<AttachmentInfo>(proc,"glGetFramebufferAttachmentParameteriv")(0x8D40,0x8CE0,0x8212,out bits);RedBits=bits;if(RedBits!=(floatingPoint?16:8))throw new Exception("Unexpected GPU framebuffer precision");UnlockAfterDraw();AwaitingRelease=false;
  }catch{Dispose();throw;}
 }
 // DXGI budget is process-local, not a claim about total cross-process GPU memory.
 public MemoryInfo ReadMemory(){IntPtr dxgi=IntPtr.Zero,adapter=IntPtr.Zero,adapter3=IntPtr.Zero;try{var id=new Guid("54ec77fa-1377-44e6-8c32-88fd5f44c84c");Hr(Com<Query>(device,0)(device,ref id,out dxgi),"Query IDXGIDevice");Hr(Com<GetAdapter>(dxgi,7)(dxgi,out adapter),"GetAdapter");id=new Guid("645967a4-1392-4310-a798-8053ce3e93fd");Hr(Com<Query>(adapter,0)(adapter,ref id,out adapter3),"Query IDXGIAdapter3");MemoryInfo info;Hr(Com<MemoryQuery>(adapter3,14)(adapter3,0,0,out info),"QueryVideoMemoryInfo");return info;}finally{if(adapter3!=IntPtr.Zero)Marshal.Release(adapter3);if(adapter!=IntPtr.Zero)Marshal.Release(adapter);if(dxgi!=IntPtr.Zero)Marshal.Release(dxgi);}}
 public static void ValidateBudget(MemoryInfo info,ulong estimated,bool allocation){ulong available=info.Budget>info.CurrentUsage?info.Budget-info.CurrentUsage:0;if(estimated>256UL*1024*1024||info.Budget==0||info.CurrentUsage>info.Budget||allocation&&(available<estimated+256UL*1024*1024||estimated>info.Budget/4))throw new Exception("DXGI video memory budget insufficient; refusing playback without quality reduction");}
 public MemoryInfo CheckBudget(bool allocation){var info=ReadMemory();ValidateBudget(info,(ulong)Width*(ulong)Height*(FloatingPoint?8UL:4UL)*3UL,allocation);return info;}
 long lastBudgetCheck;
 public void LockForDraw(){long now=System.Diagnostics.Stopwatch.GetTimestamp();if(FloatingPoint&&now-lastBudgetCheck>System.Diagnostics.Stopwatch.Frequency){CheckBudget(false);lastBudgetCheck=now;}if(!lockObjects(interop,1,new[]{registered}))throw new Exception("GPU lock failed");gpuLocked=true;bindFbo(0x8D40,fbo);}
 public void BindForDiagnostics(){bindFbo(0x8D40,fbo);}
 public void UnlockAfterDraw(){finish();if(!unlockObjects(interop,1,new[]{registered}))throw new Exception("GPU unlock failed");gpuLocked=false;Com<Copy>(context,47)(context,exportTexture,texture);Com<EndQuery>(context,28)(context,query);Com<Flush>(context,111)(context);var data=Marshal.AllocHGlobal(4);try{int count=0,status;while((status=Com<QueryData>(context,29)(context,query,data,4,0))==1){if(++count>1000)throw new Exception("GPU copy timeout");System.Threading.Thread.Sleep(1);}Hr(status,"GPU copy completion");}finally{Marshal.FreeHGlobal(data);}Frame++;AwaitingRelease=true;}
 public void Dispose(){if(disposed)return;disposed=true;if(gpuLocked&&unlockObjects!=null)unlockObjects(interop,1,new[]{registered});if(registered!=IntPtr.Zero)unregister(interop,registered);if(interop!=IntPtr.Zero)close(interop);if(fbo!=0)deleteFbos(1,ref fbo);if(tex!=0)deleteTextures(1,ref tex);if(query!=IntPtr.Zero)Marshal.Release(query);if(resource!=IntPtr.Zero)Marshal.Release(resource);if(exportTexture!=IntPtr.Zero)Marshal.Release(exportTexture);if(texture!=IntPtr.Zero)Marshal.Release(texture);if(context!=IntPtr.Zero)Marshal.Release(context);if(device!=IntPtr.Zero)Marshal.Release(device);if(localShare!=IntPtr.Zero)CloseHandle(localShare);}
}
