// Capability only. Does not load media, render pixels or certify M2.
using System;using System.Runtime.InteropServices;
class D3dCapabilityProbe {
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern IntPtr LoadLibraryEx(string path,IntPtr file,uint flags);
 [DllImport("kernel32.dll",CharSet=CharSet.Ansi)]static extern IntPtr GetProcAddress(IntPtr module,string name);
 [DllImport("kernel32.dll")]static extern bool FreeLibrary(IntPtr module);
 [DllImport("d3d11.dll")]static extern int D3D11CreateDevice(IntPtr adapter,int type,IntPtr software,uint flags,IntPtr levels,uint count,uint sdk,out IntPtr device,out uint level,out IntPtr context);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)]delegate IntPtr Create();
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)]delegate int Initialize(IntPtr handle);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)]delegate int SetOption(IntPtr handle,[MarshalAs(UnmanagedType.LPStr)]string name,[MarshalAs(UnmanagedType.LPStr)]string value);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)]delegate int RenderCreate(out IntPtr context,IntPtr handle,[In] Param[] args);
 [UnmanagedFunctionPointer(CallingConvention.Cdecl)]delegate void Free(IntPtr value);
 [StructLayout(LayoutKind.Sequential)]struct Param {public int type;public IntPtr data;public Param(int t,IntPtr d){type=t;data=d;}}
 static T Bind<T>(IntPtr dll,string name){return (T)(object)Marshal.GetDelegateForFunctionPointer(GetProcAddress(dll,name),typeof(T));}
 static void Main(string[] args){IntPtr dll=IntPtr.Zero,mpv=IntPtr.Zero,render=IntPtr.Zero,device=IntPtr.Zero,context=IntPtr.Zero,init=IntPtr.Zero,api=IntPtr.Zero;try{
  dll=LoadLibraryEx(System.IO.Path.GetFullPath(args[0]),IntPtr.Zero,0x1100);if(dll==IntPtr.Zero)throw new Exception("Load DLL "+Marshal.GetLastWin32Error());
  mpv=Bind<Create>(dll,"mpv_create")();var option=Bind<SetOption>(dll,"mpv_set_option_string");option(mpv,"config","no");option(mpv,"terminal","no");option(mpv,"vo","libmpv");option(mpv,"audio","no");int initialized=Bind<Initialize>(dll,"mpv_initialize")(mpv);if(initialized<0)throw new Exception("mpv init "+initialized);
  uint level;int hr=D3D11CreateDevice(IntPtr.Zero,1,IntPtr.Zero,0x20,IntPtr.Zero,0,7,out device,out level,out context);if(hr<0)throw new Exception("D3D device "+hr);
  init=Marshal.AllocHGlobal(IntPtr.Size);Marshal.WriteIntPtr(init,device);api=Marshal.StringToHGlobalAnsi("d3d11");int result=Bind<RenderCreate>(dll,"mpv_render_context_create")(out render,mpv,new[]{new Param(1,api),new Param(21,init),new Param()});Console.WriteLine("{\"renderApi\":\"d3d11\",\"result\":"+result+",\"deviceFeatureLevel\":"+level+",\"contextCreated\":"+(render!=IntPtr.Zero?"true":"false")+"}");if(result<0)Environment.ExitCode=1;
 }catch(Exception e){Console.Error.WriteLine(e);Environment.ExitCode=1;}finally{if(render!=IntPtr.Zero)Bind<Free>(dll,"mpv_render_context_free")(render);if(mpv!=IntPtr.Zero)Bind<Free>(dll,"mpv_terminate_destroy")(mpv);if(api!=IntPtr.Zero)Marshal.FreeHGlobal(api);if(init!=IntPtr.Zero)Marshal.FreeHGlobal(init);if(context!=IntPtr.Zero)Marshal.Release(context);if(device!=IntPtr.Zero)Marshal.Release(device);if(dll!=IntPtr.Zero)FreeLibrary(dll);}}
}
