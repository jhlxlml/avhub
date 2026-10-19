param([Parameter(Mandatory=$true)][string]$HostHandle,[string]$ControlHandle)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class AVHubWindowEvidence {
  public delegate bool EnumProc(IntPtr hwnd, IntPtr data);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc proc, IntPtr data);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr hwnd, out Rect rect);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll")] public static extern long GetWindowLongPtrW(IntPtr hwnd, int index);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr hwnd, StringBuilder value, int count);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr hwnd, uint command);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern int GetWindowRgn(IntPtr hwnd, IntPtr region);
  [DllImport("gdi32.dll")] public static extern IntPtr CreateRectRgn(int left,int top,int right,int bottom);
  [DllImport("gdi32.dll")] public static extern int GetRgnBox(IntPtr region,out Rect rect);
  [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr value);
  public static object Client(IntPtr hwnd) {
    var previous=SetThreadDpiAwarenessContext(new IntPtr(-4));
    try { Rect client;if(!GetClientRect(hwnd,out client))throw new System.ComponentModel.Win32Exception();return new {width=client.Right-client.Left,height=client.Bottom-client.Top,dpi=GetDpiForWindow(hwnd)}; }
    finally { if(previous!=IntPtr.Zero)SetThreadDpiAwarenessContext(previous); }
  }
  public static object Read(IntPtr hwnd) {
    Rect rect; GetWindowRect(hwnd,out rect); uint pid; GetWindowThreadProcessId(hwnd,out pid);
    var name=new StringBuilder(256);GetClassNameW(hwnd,name,256);
    var region=CreateRectRgn(0,0,0,0);var regionType=GetWindowRgn(hwnd,region);Rect clip;GetRgnBox(region,out clip);DeleteObject(region);
    return new { handle=hwnd.ToInt64().ToString(), pid=pid, className=name.ToString(),parent=GetParent(hwnd).ToInt64().ToString(),owner=GetWindow(hwnd,4).ToInt64().ToString(),previous=GetWindow(hwnd,3).ToInt64().ToString(),visible=IsWindowVisible(hwnd),
      x=rect.Left,y=rect.Top,width=rect.Right-rect.Left,height=rect.Bottom-rect.Top,
      dpi=GetDpiForWindow(hwnd),client=Client(hwnd),regionType=regionType,clipTop=clip.Top,clipBottom=clip.Bottom,
      style=GetWindowLongPtrW(hwnd,-16),exStyle=GetWindowLongPtrW(hwnd,-20) };
  }
  public static object[] Children(IntPtr hwnd) {
    var rows=new List<object>(); EnumChildWindows(hwnd,(child,data)=>{rows.Add(Read(child));return true;},IntPtr.Zero);
    return rows.ToArray();
  }
}
'@
$nativeHandle = [IntPtr]::new([long]::Parse($HostHandle))
$controlEvidence = if ($ControlHandle) { [AVHubWindowEvidence]::Read([IntPtr]::new([long]::Parse($ControlHandle))) } else { $null }
[pscustomobject]@{hostWindow=[AVHubWindowEvidence]::Read($nativeHandle);children=[AVHubWindowEvidence]::Children($nativeHandle);controlsWindow=$controlEvidence} | ConvertTo-Json -Depth 6 -Compress
