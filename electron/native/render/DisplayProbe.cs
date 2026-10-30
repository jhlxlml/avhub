// Read-only M2 display evidence. No SetDisplayConfig / HDR state mutation.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public static class DisplayProbe {
 [DllImport("dxgi.dll")] static extern int CreateDXGIFactory1(ref Guid id,out IntPtr factory);
 [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr window,uint flags);
 [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr window);
 [DllImport("user32.dll")] static extern int GetDisplayConfigBufferSizes(uint flags,out uint paths,out uint modes);
 [DllImport("user32.dll")] static extern int QueryDisplayConfig(uint flags,ref uint paths,IntPtr pathInfo,ref uint modes,IntPtr modeInfo,IntPtr topology);
 [DllImport("user32.dll")] static extern int DisplayConfigGetDeviceInfo(IntPtr info);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int Query(IntPtr self,ref Guid id,out IntPtr value);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int Enumerate(IntPtr self,uint index,out IntPtr value);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int DescribeAdapter(IntPtr self,IntPtr desc);
 [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int Describe(IntPtr self,out OutputDesc desc);
 [StructLayout(LayoutKind.Sequential)] public struct Rect {public int left,top,right,bottom;}
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public struct OutputDesc {
  [MarshalAs(UnmanagedType.ByValTStr,SizeConst=32)] public string deviceName;
  public Rect bounds;public int attached,rotation;public IntPtr monitor;public uint bitsPerColor,colorSpace;
  public float redX,redY,greenX,greenY,blueX,blueY,whiteX,whiteY,minLuminance,maxLuminance,maxFullFrameLuminance;
 }
 [StructLayout(LayoutKind.Sequential)] public struct Luid {public uint low;public int high;}
 [StructLayout(LayoutKind.Sequential)] public struct Source {public Luid adapter;public uint id,mode,status;}
 [StructLayout(LayoutKind.Sequential)] public struct Target {public Luid adapter;public uint id,mode;public int technology,rotation,scaling;public uint rateN,rateD;public int scan,available;public uint status;}
 [StructLayout(LayoutKind.Sequential)] public struct PathInfo {public Source source;public Target target;public uint flags;}
 public sealed class AdvancedPath {
  public string deviceName,query,friendlyName;public int targetNameError,outputTechnology;public bool? edidIdsValid;public uint targetId,rawFlags,bitsPerColor,colorEncoding;public int info2Error,legacyError;
  public bool? supported,active,limitedByPolicy,hdrSupported,hdrUserEnabled,wideColorSupported,wideColorUserEnabled;
  public uint? activeColorMode;
 }
 static T Com<T>(IntPtr obj,int slot){return (T)(object)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(Marshal.ReadIntPtr(obj),slot*IntPtr.Size),typeof(T));}
 static void Hr(int value,string stage){if(value<0)throw new Exception(stage+" HRESULT 0x"+value.ToString("X8"));}
 static IntPtr Info(int type,int size,Luid adapter,uint id){var p=Marshal.AllocHGlobal(size);Marshal.Copy(new byte[size],0,p,size);Marshal.WriteInt32(p,type);Marshal.WriteInt32(p,4,size);Marshal.WriteInt32(p,8,unchecked((int)adapter.low));Marshal.WriteInt32(p,12,adapter.high);Marshal.WriteInt32(p,16,unchecked((int)id));return p;}
 static AdvancedPath Advanced(PathInfo path,string name){
  var row=new AdvancedPath{deviceName=name,targetId=path.target.id,query="unavailable",outputTechnology=path.target.technology};
  var targetName=Info(2,420,path.target.adapter,path.target.id);try{row.targetNameError=DisplayConfigGetDeviceInfo(targetName);if(row.targetNameError==0){row.friendlyName=Marshal.PtrToStringUni(IntPtr.Add(targetName,36),64).TrimEnd('\0');row.edidIdsValid=(Marshal.ReadInt32(targetName,20)&4)!=0;}}finally{Marshal.FreeHGlobal(targetName);}
  var p=Info(15,36,path.target.adapter,path.target.id);
  try{row.info2Error=DisplayConfigGetDeviceInfo(p);if(row.info2Error==0){uint bits=unchecked((uint)Marshal.ReadInt32(p,20));row.query="advanced-color-info-2";row.rawFlags=bits;row.supported=(bits&1)!=0;row.active=(bits&2)!=0;row.limitedByPolicy=(bits&8)!=0;row.hdrSupported=(bits&16)!=0;row.hdrUserEnabled=(bits&32)!=0;row.wideColorSupported=(bits&64)!=0;row.wideColorUserEnabled=(bits&128)!=0;row.colorEncoding=unchecked((uint)Marshal.ReadInt32(p,24));row.bitsPerColor=unchecked((uint)Marshal.ReadInt32(p,28));row.activeColorMode=unchecked((uint)Marshal.ReadInt32(p,32));return row;}}finally{Marshal.FreeHGlobal(p);}
  p=Info(9,32,path.target.adapter,path.target.id);
  try{row.legacyError=DisplayConfigGetDeviceInfo(p);if(row.legacyError==0){uint bits=unchecked((uint)Marshal.ReadInt32(p,20));row.query="advanced-color-info";row.rawFlags=bits;row.supported=(bits&1)!=0;row.active=(bits&2)!=0;row.limitedByPolicy=(bits&8)!=0;row.colorEncoding=unchecked((uint)Marshal.ReadInt32(p,24));row.bitsPerColor=unchecked((uint)Marshal.ReadInt32(p,28));}}finally{Marshal.FreeHGlobal(p);}return row;
 }
 static List<AdvancedPath> Paths(){
  for(int attempt=0;attempt<3;attempt++){
   uint pc,mc;int status=GetDisplayConfigBufferSizes(2,out pc,out mc);if(status!=0)throw new Exception("GetDisplayConfigBufferSizes "+status);
   if(pc>512||mc>512)throw new Exception("Display topology exceeds bounded probe capacity");
   var paths=Marshal.AllocHGlobal((int)Math.Max(1,pc)*72);var modes=Marshal.AllocHGlobal((int)Math.Max(1,mc)*64);
   try{uint capacity=pc;status=QueryDisplayConfig(2,ref pc,paths,ref mc,modes,IntPtr.Zero);if(status==122)continue;if(status!=0)throw new Exception("QueryDisplayConfig "+status);if(pc>capacity)throw new Exception("Invalid topology count");
    var rows=new List<AdvancedPath>();for(int i=0;i<pc;i++){var path=(PathInfo)Marshal.PtrToStructure(IntPtr.Add(paths,i*72),typeof(PathInfo));if((path.flags&1)==0||path.target.available==0)continue;var name=Info(1,84,path.source.adapter,path.source.id);try{status=DisplayConfigGetDeviceInfo(name);if(status!=0)throw new Exception("Source device name "+status);rows.Add(Advanced(path,Marshal.PtrToStringUni(IntPtr.Add(name,20),32).TrimEnd('\0')));}finally{Marshal.FreeHGlobal(name);}}return rows;
   }finally{Marshal.FreeHGlobal(paths);Marshal.FreeHGlobal(modes);}
  }throw new Exception("Display topology changed during all probe attempts");
 }
 public static object Read(IntPtr window){
  if(IntPtr.Size!=8||Marshal.SizeOf(typeof(OutputDesc))!=152||Marshal.SizeOf(typeof(PathInfo))!=72)throw new Exception("Unverified display ABI");
  var errors=new List<string>();List<AdvancedPath> paths;try{paths=Paths();}catch(Exception e){paths=new List<AdvancedPath>();errors.Add(e.Message);}
  var adapters=new List<object>();var outputs=new List<object>();IntPtr factory=IntPtr.Zero;var id=new Guid("770aae78-f26f-4dba-a829-253c83d1b387");
  try{Hr(CreateDXGIFactory1(ref id,out factory),"CreateDXGIFactory1");for(uint ai=0;ai<32;ai++){IntPtr adapter;int status=Com<Enumerate>(factory,12)(factory,ai,out adapter);if(status==unchecked((int)0x887A0002))break;Hr(status,"EnumAdapters1");try{var adapterDesc=Marshal.AllocHGlobal(512);try{Hr(Com<DescribeAdapter>(adapter,10)(adapter,adapterDesc),"GetAdapterDesc1");adapters.Add(new{name=Marshal.PtrToStringUni(adapterDesc,128).TrimEnd('\0'),vendor=Marshal.ReadInt32(adapterDesc,256),device=Marshal.ReadInt32(adapterDesc,260),luid=Marshal.ReadInt64(adapterDesc,296).ToString("X16")});}finally{Marshal.FreeHGlobal(adapterDesc);}for(uint oi=0;oi<32;oi++){IntPtr output;status=Com<Enumerate>(adapter,7)(adapter,oi,out output);if(status==unchecked((int)0x887A0002))break;Hr(status,"EnumOutputs");IntPtr output6=IntPtr.Zero;try{id=new Guid("068346e8-aaec-4b84-add7-137f513f77a1");Hr(Com<Query>(output,0)(output,ref id,out output6),"Query IDXGIOutput6");OutputDesc desc;Hr(Com<Describe>(output6,27)(output6,out desc),"GetDesc1");outputs.Add(new{deviceName=desc.deviceName,monitor=desc.monitor.ToInt64().ToString(),attached=desc.attached!=0,bounds=desc.bounds,bitsPerColor=desc.bitsPerColor,colorSpace=desc.colorSpace,minLuminance=desc.minLuminance,maxLuminance=desc.maxLuminance,maxFullFrameLuminance=desc.maxFullFrameLuminance,primaries=new{red=new[]{desc.redX,desc.redY},green=new[]{desc.greenX,desc.greenY},blue=new[]{desc.blueX,desc.blueY},white=new[]{desc.whiteX,desc.whiteY}}});}catch(Exception e){errors.Add(e.Message);}finally{if(output6!=IntPtr.Zero)Marshal.Release(output6);Marshal.Release(output);}}}finally{Marshal.Release(adapter);}}}catch(Exception e){errors.Add(e.Message);}finally{if(factory!=IntPtr.Zero)Marshal.Release(factory);}
  return new{scope="read-only native display evidence, not HDR playback certification",readAtUtc=DateTime.UtcNow.ToString("o"),selectedMonitor=window==IntPtr.Zero?null:MonitorFromWindow(window,2).ToInt64().ToString(),windowDpi=window==IntPtr.Zero?0:GetDpiForWindow(window),queryComplete=errors.Count==0,adapters=adapters,outputs=outputs,advancedPaths=paths,errors=errors};
 }
}
