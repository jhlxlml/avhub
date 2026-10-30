// Application native render target, promoted from the attested M2 D3D11 path.
// Original dimensions, one GPU reader lease, no WGL or CPU video upload.
using System;using System.Runtime.InteropServices;using System.Threading;
sealed class D3dSurface : IDisposable {
 [StructLayout(LayoutKind.Sequential)] public struct MemoryInfo {public ulong Budget,CurrentUsage,AvailableForReservation,CurrentReservation;}
 static void ValidateBudget(MemoryInfo info,ulong estimated,bool allocation){ulong available=info.Budget>info.CurrentUsage?info.Budget-info.CurrentUsage:0;if(allocation&&info.Budget>0&&estimated>available)throw new Exception("DXGI available memory cannot hold original-size surfaces; no quality reduction fallback");}
 [DllImport("d3d11.dll")]static extern int D3D11CreateDevice(IntPtr adapter,int type,IntPtr software,uint flags,IntPtr levels,uint count,uint sdk,out IntPtr device,out uint level,out IntPtr context);
 [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr handle);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)]delegate int Query(IntPtr self,ref Guid id,out IntPtr value);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)]delegate int GetAdapter(IntPtr self,out IntPtr adapter);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)]delegate int AdapterDesc(IntPtr self,IntPtr desc);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)]delegate int TextureCreate(IntPtr self,ref Desc desc,IntPtr data,out IntPtr texture);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)]delegate void TextureDesc(IntPtr self,out Desc desc);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)]delegate int Share(IntPtr self,IntPtr attributes,uint access,IntPtr name,out IntPtr handle);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)]delegate int QueryCreate(IntPtr self,ref QueryDesc desc,out IntPtr query);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)]delegate void EndQuery(IntPtr self,IntPtr query);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)]delegate int QueryData(IntPtr self,IntPtr query,IntPtr data,uint size,uint flags);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)]delegate void Flush(IntPtr self);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)]delegate void CopyRegion(IntPtr self,IntPtr destination,uint subresource,uint x,uint y,uint z,IntPtr source,uint sourceSubresource,ref Box box);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)]delegate int Map(IntPtr self,IntPtr resource,uint subresource,uint type,uint flags,out Mapped mapped);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)]delegate void Unmap(IntPtr self,IntPtr resource,uint subresource);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)]delegate int MemoryQuery(IntPtr self,uint node,uint segment,out MemoryInfo info);
 [StructLayout(LayoutKind.Sequential)]struct Desc {public uint width,height,mips,array,format,sampleCount,sampleQuality,usage,bind,cpu,misc;}
 [StructLayout(LayoutKind.Sequential)]struct QueryDesc {public uint type,misc;}
 [StructLayout(LayoutKind.Sequential)]struct Box {public uint left,top,front,right,bottom,back;}
 [StructLayout(LayoutKind.Sequential)]struct Mapped {public IntPtr data;public uint rowPitch,depthPitch;}
 public IntPtr Device {get{return device;}}public IntPtr Texture {get{return texture;}}
 IntPtr device,context,texture,resource,share,query,staging,staging8;bool disposed;long lastBudgetCheck;
 long frame;volatile bool awaitingRelease;
 public long Frame {get{return Interlocked.Read(ref frame);}}public bool AwaitingRelease {get{return awaitingRelease;}set{awaitingRelease=value;}}
 public int Width {get;private set;}public int Height {get;private set;}public int RedBits {get;private set;}public bool FloatingPoint {get;private set;}
 public string Handle {get{return share.ToInt64().ToString();}}public int Fbo {get{return 0;}}
 public string GlDeviceLuid {get{return null;}}public string AdapterLuid {get;private set;}public string AdapterMatch {get{return "owned-d3d11-device";}}public string Description {get;private set;}
 static T Com<T>(IntPtr obj,int index){return (T)(object)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(Marshal.ReadIntPtr(obj),index*IntPtr.Size),typeof(T));}
 static void Hr(int value,string stage){if(value<0)throw new Exception(stage+" HRESULT 0x"+value.ToString("X8"));}
 public D3dSurface(int width,int height,bool floatingPoint){
  if(width<1||height<1||width>16384||height>16384)throw new Exception("Original dimensions exceed D3D11 texture limits; no downscale fallback");Width=width;Height=height;FloatingPoint=floatingPoint;
  try{uint level;Hr(D3D11CreateDevice(IntPtr.Zero,1,IntPtr.Zero,0x20,IntPtr.Zero,0,7,out device,out level,out context),"Create D3D11 device");
   IntPtr dxgi=IntPtr.Zero,adapter=IntPtr.Zero;try{var id=new Guid("54ec77fa-1377-44e6-8c32-88fd5f44c84c");Hr(Com<Query>(device,0)(device,ref id,out dxgi),"Query DXGI device");Hr(Com<GetAdapter>(dxgi,7)(dxgi,out adapter),"Get adapter");var buffer=Marshal.AllocHGlobal(512);try{Hr(Com<AdapterDesc>(adapter,8)(adapter,buffer),"Adapter description");Description=Marshal.PtrToStringUni(buffer,128).TrimEnd('\0');AdapterLuid=Marshal.ReadInt64(buffer,296).ToString("X16");}finally{Marshal.FreeHGlobal(buffer);}}finally{if(adapter!=IntPtr.Zero)Marshal.Release(adapter);if(dxgi!=IntPtr.Zero)Marshal.Release(dxgi);}
   Resize(width,height);
   var q=new QueryDesc();Hr(Com<QueryCreate>(device,24)(device,ref q,out query),"Create GPU event");
  }catch{Dispose();throw;}
 }
 void ReleaseTarget(){
  if(staging8!=IntPtr.Zero){Marshal.Release(staging8);staging8=IntPtr.Zero;}if(staging!=IntPtr.Zero){Marshal.Release(staging);staging=IntPtr.Zero;}
  if(resource!=IntPtr.Zero){Marshal.Release(resource);resource=IntPtr.Zero;}if(texture!=IntPtr.Zero){Marshal.Release(texture);texture=IntPtr.Zero;}
  if(share!=IntPtr.Zero){CloseHandle(share);share=IntPtr.Zero;}
 }
 public void Resize(int width,int height){
  if(AwaitingRelease)throw new Exception("Cannot resize a target with GPU readers");
  if(width<1||height<1||width>16384||height>16384)throw new Exception("Original dimensions exceed D3D11 texture limits; no downscale fallback");
  ReleaseTarget();Width=width;Height=height;if(FloatingPoint)CheckBudget(true);
  var desc=new Desc{width=(uint)width,height=(uint)height,mips=1,array=1,format=FloatingPoint?10U:28U,sampleCount=1,bind=0x28,misc=0x802};Hr(Com<TextureCreate>(device,5)(device,ref desc,IntPtr.Zero,out texture),"Create shared render target");
  Desc actual;Com<TextureDesc>(texture,10)(texture,out actual);if(actual.width!=width||actual.height!=height||actual.format!=desc.format)throw new Exception("Actual texture differs from original source contract");RedBits=actual.format==10?16:8;
  var id=new Guid("30961379-4609-4a41-998e-54fe567ee0c1");Hr(Com<Query>(texture,0)(texture,ref id,out resource),"Query shared resource");Hr(Com<Share>(resource,13)(resource,IntPtr.Zero,0x80000001,IntPtr.Zero,out share),"Create shared NT handle");
 }
 public void LockForDraw(){if(AwaitingRelease)throw new Exception("Previous GPU readers remain");long now=System.Diagnostics.Stopwatch.GetTimestamp();if(FloatingPoint&&now-lastBudgetCheck>System.Diagnostics.Stopwatch.Frequency){CheckBudget(false);lastBudgetCheck=now;}}
 public void UnlockAfterDraw(){Com<EndQuery>(context,28)(context,query);Com<Flush>(context,111)(context);var data=Marshal.AllocHGlobal(4);try{int status,count=0;while((status=Com<QueryData>(context,29)(context,query,data,4,0))==1){if(++count>1000)throw new Exception("D3D11 GPU completion timeout");Thread.Sleep(1);}Hr(status,"D3D11 GPU completion");}finally{Marshal.FreeHGlobal(data);}Interlocked.Increment(ref frame);AwaitingRelease=true;}
 public void BindForDiagnostics(){}
 static float Half(ushort value){int exponent=(value>>10)&31,mantissa=value&1023;double sign=(value&32768)==0?1:-1;return (float)(exponent==0?sign*mantissa*Math.Pow(2,-24):exponent==31?double.NaN:sign*(1+mantissa/1024.0)*Math.Pow(2,exponent-15));}
 public float[] ReadDiagnosticRow(){
  if(!FloatingPoint)throw new Exception("F16 row required");if(staging==IntPtr.Zero){var desc=new Desc{width=(uint)Width,height=1,mips=1,array=1,format=10,sampleCount=1,usage=3,cpu=0x20000};Hr(Com<TextureCreate>(device,5)(device,ref desc,IntPtr.Zero,out staging),"Create diagnostic row");}
  var box=new Box{top=(uint)(Height/2),right=(uint)Width,bottom=(uint)(Height/2+1),back=1};Com<CopyRegion>(context,46)(context,staging,0,0,0,0,texture,0,ref box);Mapped mapped;Hr(Com<Map>(context,14)(context,staging,0,1,0,out mapped),"Map diagnostic row");try{var shorts=new short[Width*4];Marshal.Copy(mapped.data,shorts,0,shorts.Length);return Array.ConvertAll(shorts,x=>Half(unchecked((ushort)x)));}finally{Com<Unmap>(context,15)(context,staging,0);}
 }
 public byte[] ReadDiagnosticPixel(){
  if(!FloatingPoint){
   if(staging8==IntPtr.Zero){var desc=new Desc{width=1,height=1,mips=1,array=1,format=28,sampleCount=1,usage=3,cpu=0x20000};Hr(Com<TextureCreate>(device,5)(device,ref desc,IntPtr.Zero,out staging8),"Create diagnostic pixel");}
   var box=new Box{left=(uint)(Width/4),top=(uint)(Height/2),right=(uint)(Width/4+1),bottom=(uint)(Height/2+1),back=1};Com<CopyRegion>(context,46)(context,staging8,0,0,0,0,texture,0,ref box);Mapped mapped;Hr(Com<Map>(context,14)(context,staging8,0,1,0,out mapped),"Map diagnostic pixel");try{var bytes=new byte[4];Marshal.Copy(mapped.data,bytes,0,4);return bytes;}finally{Com<Unmap>(context,15)(context,staging8,0);}
  }
  var row=ReadDiagnosticRow();int at=(Width/4)*4;var pixel=new byte[4];for(int i=0;i<4;i++)pixel[i]=(byte)Math.Round(Math.Max(0,Math.Min(1,row[at+i]))*255);return pixel;
 }
 public MemoryInfo CheckBudget(bool allocation){IntPtr dxgi=IntPtr.Zero,adapter=IntPtr.Zero,adapter3=IntPtr.Zero;try{var id=new Guid("54ec77fa-1377-44e6-8c32-88fd5f44c84c");Hr(Com<Query>(device,0)(device,ref id,out dxgi),"Query DXGI device");Hr(Com<GetAdapter>(dxgi,7)(dxgi,out adapter),"Get adapter");id=new Guid("645967a4-1392-4310-a798-8053ce3e93fd");Hr(Com<Query>(adapter,0)(adapter,ref id,out adapter3),"Query adapter3");MemoryInfo info;Hr(Com<MemoryQuery>(adapter3,14)(adapter3,0,0,out info),"Query video memory");ValidateBudget(info,(ulong)Width*(ulong)Height*(FloatingPoint?8UL:4UL)*3UL,allocation);return info;}finally{if(adapter3!=IntPtr.Zero)Marshal.Release(adapter3);if(adapter!=IntPtr.Zero)Marshal.Release(adapter);if(dxgi!=IntPtr.Zero)Marshal.Release(dxgi);}}
 public void Dispose(){if(disposed)return;disposed=true;ReleaseTarget();if(query!=IntPtr.Zero)Marshal.Release(query);if(context!=IntPtr.Zero)Marshal.Release(context);if(device!=IntPtr.Zero)Marshal.Release(device);}
}
