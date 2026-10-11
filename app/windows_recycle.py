"""Windows Shell recycle bridge. Operates on one enumerated Shell item, never a bin.

Only trusted journal identities reach this module. No wildcard deletion, filesystem
trash manipulation, undo stack, permanent-delete fallback or source video copies.
"""
import base64
import json
import os
from pathlib import Path
import subprocess
import queue
import threading

class UncertainRecycleError(OSError):
    uncertain=True

# Embedded so frozen backend builds need no external script/runtime dependency.
# Shell namespace items (not physical $R paths) ensure Windows manages its metadata.
CS = r'''
using System;
using System.IO;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
[ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface SI {
 void BindToHandler(IntPtr bc, ref Guid bhid, ref Guid iid, out IntPtr value);
 void GetParent(out SI parent); void GetDisplayName(uint type,out IntPtr name);
 void GetAttributes(uint mask,out uint attrs); void Compare(SI other,uint hint,out int order);
}
[ComImport, Guid("70629033-E363-4A28-A567-0DB78006E6D7"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface EI {
 [PreserveSig] int Next(uint count,out SI item,out uint fetched);
 void Skip(uint count); void Reset(); void Clone(out EI value);
}
[ComVisible(true), Guid("04B0F1A7-9490-44BC-96E1-4296A31252E2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface PS {
 [PreserveSig] int StartOperations(); [PreserveSig] int FinishOperations(int hr);
 [PreserveSig] int PreRenameItem(uint flags,SI item,[MarshalAs(UnmanagedType.LPWStr)]string name);
 [PreserveSig] int PostRenameItem(uint flags,SI item,[MarshalAs(UnmanagedType.LPWStr)]string name,int hr,SI result);
 [PreserveSig] int PreMoveItem(uint flags,SI item,SI dest,[MarshalAs(UnmanagedType.LPWStr)]string name);
 [PreserveSig] int PostMoveItem(uint flags,SI item,SI dest,[MarshalAs(UnmanagedType.LPWStr)]string name,int hr,SI result);
 [PreserveSig] int PreCopyItem(uint flags,SI item,SI dest,[MarshalAs(UnmanagedType.LPWStr)]string name);
 [PreserveSig] int PostCopyItem(uint flags,SI item,SI dest,[MarshalAs(UnmanagedType.LPWStr)]string name,int hr,SI result);
 [PreserveSig] int PreDeleteItem(uint flags,SI item);
 [PreserveSig] int PostDeleteItem(uint flags,SI item,int hr,SI result);
 [PreserveSig] int PreNewItem(uint flags,SI dest,[MarshalAs(UnmanagedType.LPWStr)]string name);
 [PreserveSig] int PostNewItem(uint flags,SI dest,[MarshalAs(UnmanagedType.LPWStr)]string name,[MarshalAs(UnmanagedType.LPWStr)]string template,uint attrs,int hr,SI result);
 [PreserveSig] int UpdateProgress(uint total,uint done);
 [PreserveSig] int ResetTimer(); [PreserveSig] int PauseTimer(); [PreserveSig] int ResumeTimer();
}
[ComImport, Guid("947AAB5F-0A5C-4C13-B4D6-4BF7836FC9F8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface FO {
 void Advise(PS sink,out uint cookie); void Unadvise(uint cookie); void SetOperationFlags(uint flags);
 void SetProgressMessage([MarshalAs(UnmanagedType.LPWStr)]string text); void SetProgressDialog(IntPtr value); void SetProperties(IntPtr value); void SetOwnerWindow(uint hwnd);
 void ApplyPropertiesToItem(SI item); void ApplyPropertiesToItems(IntPtr items);
 void RenameItem(SI item,[MarshalAs(UnmanagedType.LPWStr)]string name,PS sink); void RenameItems(IntPtr items,[MarshalAs(UnmanagedType.LPWStr)]string name);
 void MoveItem(SI item,SI dest,[MarshalAs(UnmanagedType.LPWStr)]string name,PS sink); void MoveItems(IntPtr items,SI dest);
 void CopyItem(SI item,SI dest,[MarshalAs(UnmanagedType.LPWStr)]string name,PS sink); void CopyItems(IntPtr items,SI dest);
 void DeleteItem(SI item,PS sink); void DeleteItems(IntPtr items);
 void NewItem(SI dest,uint attrs,[MarshalAs(UnmanagedType.LPWStr)]string name,[MarshalAs(UnmanagedType.LPWStr)]string template,PS sink);
 void PerformOperations(); void GetAnyOperationsAborted([MarshalAs(UnmanagedType.Bool)]out bool aborted);
}
[ComVisible(true), ClassInterface(ClassInterfaceType.None)]
public class Guard : PS {
 public string Source,Target; public string[] Stamp; public bool Delete; public int Result=unchecked((int)0x80004005);
 const int Deny=unchecked((int)0x80070005);
 public int StartOperations(){return 0;} public int FinishOperations(int hr){return 0;}
 public int PreRenameItem(uint f,SI i,string n){return Deny;} public int PostRenameItem(uint f,SI i,string n,int h,SI r){return 0;}
 public int PreMoveItem(uint f,SI i,SI d,string n){
  try {return !Delete && RecycleBridge.Name(i)==Source && RecycleBridge.Matches(Source,Stamp) && RecycleBridge.Name(d)==Path.GetDirectoryName(Target) && n==Path.GetFileName(Target) && RecycleBridge.SafeTarget(Target) ? 0 : Deny;}catch{return Deny;}
 }
 public int PostMoveItem(uint f,SI i,SI d,string n,int h,SI r){Result=h;return 0;}
 public int PreCopyItem(uint f,SI i,SI d,string n){return Deny;} public int PostCopyItem(uint f,SI i,SI d,string n,int h,SI r){return 0;}
 public int PreDeleteItem(uint f,SI i){try{return Delete && RecycleBridge.Name(i)==Source && RecycleBridge.Matches(Source,Stamp) ? 0 : Deny;}catch{return Deny;}}
 public int PostDeleteItem(uint f,SI i,int h,SI r){Result=h;return 0;}
 public int PreNewItem(uint f,SI d,string n){return Deny;} public int PostNewItem(uint f,SI d,string n,string t,uint a,int h,SI r){return 0;}
 public int UpdateProgress(uint t,uint d){return 0;} public int ResetTimer(){return 0;} public int PauseTimer(){return 0;} public int ResumeTimer(){return 0;}
}
public static class RecycleBridge {
 static Dictionary<string,SI> cache=new Dictionary<string,SI>(StringComparer.Ordinal);
 static DateTime cacheTime=DateTime.MinValue;
 public static void Clear(){foreach(var item in cache.Values)Marshal.ReleaseComObject(item);cache.Clear();cacheTime=DateTime.MinValue;}
 static bool NoLinks(string path){
  for(var node=path;!String.IsNullOrEmpty(node);node=Path.GetDirectoryName(node))if((File.GetAttributes(node)&FileAttributes.ReparsePoint)!=0)return false;
  return true;
 }
 public static bool SafeTarget(string path){
  try{File.GetAttributes(path);return false;}catch(FileNotFoundException){}catch(DirectoryNotFoundException){return false;}
  return NoLinks(Path.GetDirectoryName(path));
 }
 [StructLayout(LayoutKind.Sequential)] struct ID {public ulong Volume,Low,High;}
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetFileInformationByHandleEx(SafeFileHandle h,int type,out ID id,uint size);
 public static bool Matches(string path,string[] stamp){
  if(stamp==null || stamp.Length!=4)return false;
  if(!NoLinks(path))return false;
  using(var stream=new FileStream(path,FileMode.Open,FileAccess.Read,FileShare.ReadWrite|FileShare.Delete)){
   ID id;if(!GetFileInformationByHandleEx(stream.SafeFileHandle,18,out id,24))return false;
   // NTFS file IDs fit 64 bits. Reject unsupported IDs instead of weakening identity.
   var ns=(File.GetLastWriteTimeUtc(path).Ticks-621355968000000000L)*100L;
   return id.High==0 && id.Volume.ToString()==stamp[0] && id.Low.ToString()==stamp[1] && stream.Length.ToString()==stamp[2] && Math.Abs(ns-long.Parse(stamp[3]))<=1000;
  }
 }
 [DllImport("shell32.dll",PreserveSig=false)] static extern void SHGetKnownFolderItem(ref Guid folder,uint flags,IntPtr token,ref Guid iid,out SI item);
 [DllImport("shell32.dll",CharSet=CharSet.Unicode,PreserveSig=false)] static extern void SHCreateItemFromParsingName(string path,IntPtr bc,ref Guid iid,out SI item);
 public static string Name(SI item){IntPtr p;item.GetDisplayName(0x80058000,out p);try{return Marshal.PtrToStringUni(p);}finally{Marshal.FreeCoTaskMem(p);}}
 static EI Items(){
  Guid folder=new Guid("B7534046-3ECB-4C18-BE4E-64CD4CB7D6AC"),iid=typeof(SI).GUID,bhid=new Guid("94F60519-2850-4924-AA5A-D15E84868039"),ei=typeof(EI).GUID;
  SI bin;SHGetKnownFolderItem(ref folder,0,IntPtr.Zero,ref iid,out bin);
  try{IntPtr p;bin.BindToHandler(IntPtr.Zero,ref bhid,ref ei,out p);try{return (EI)Marshal.GetObjectForIUnknown(p);}finally{Marshal.Release(p);}}finally{Marshal.ReleaseComObject(bin);}
 }
 public static string[] List(){
  Clear();var result=new List<string>();var items=Items();SI item;uint fetched;
  try{int hr;while((hr=items.Next(1,out item,out fetched))==0 && fetched==1){bool keep=false;try{uint attrs;item.GetAttributes(0x20000000,out attrs);if((attrs&0x20000000)==0){var name=Name(item);result.Add(name);if(cache.Count<4000 && !cache.ContainsKey(name)){cache.Add(name,item);keep=true;}}}finally{if(!keep)Marshal.ReleaseComObject(item);}}if(hr<0)Marshal.ThrowExceptionForHR(hr);}catch{Clear();throw;}finally{Marshal.ReleaseComObject(items);}
  cacheTime=DateTime.UtcNow;
  return result.ToArray();
 }
 public static int Prime(string[] paths){
  if(paths==null || paths.Length>500)throw new IOException("Invalid batch lease");
  var wanted=new HashSet<string>(paths,StringComparer.Ordinal);bool complete=(DateTime.UtcNow-cacheTime).TotalSeconds<=30;
  foreach(var p in wanted)if(!cache.ContainsKey(p))complete=false;
  if(complete)return 0;
  Clear();var items=Items();SI item;uint fetched;
  try{int hr;while((hr=items.Next(1,out item,out fetched))==0 && fetched==1){bool keep=false;try{var name=Name(item);if(wanted.Contains(name) && !cache.ContainsKey(name)){cache.Add(name,item);keep=true;}}finally{if(!keep)Marshal.ReleaseComObject(item);}}if(hr<0)Marshal.ThrowExceptionForHR(hr);}catch{Clear();throw;}finally{Marshal.ReleaseComObject(items);}
  cacheTime=DateTime.UtcNow;return 1;
 }
 public static void Execute(string source,string target,bool delete,string[] stamp){
  // Only a Shell item enumerated in this worker can be used. Leases are bounded;
  // every operation and pre-operation callback rechecks the real file identity.
  if((DateTime.UtcNow-cacheTime).TotalSeconds>30)Clear();
  SI found=null,item;uint fetched;
  if(cache.TryGetValue(source,out found))cache.Remove(source);
  else{var items=Items();try{while(items.Next(1,out item,out fetched)==0 && fetched==1){bool match=false;try{match=Name(item)==source;}catch(COMException){}if(match){if(found!=null){Marshal.ReleaseComObject(item);Marshal.ReleaseComObject(found);throw new IOException("Ambiguous recycle item");}found=item;}else Marshal.ReleaseComObject(item);}}finally{Marshal.ReleaseComObject(items);}}
  if(found==null)throw new FileNotFoundException("Recycle item not found");
  FO op=null;SI dest=null;
  try{
   op=(FO)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("3AD05575-8857-4850-9277-11B85BDB8E09")));
   // Delete is a separately confirmed permanent action. Restore never accepts
   // Yes-to-All; collision renaming prevents overwrites and the sink vetoes it.
   op.SetOperationFlags((uint)(0x00100000|0x0400|0x0004|0x2000|(delete?0x0010:0x0008)));
   if(!Matches(source,stamp))throw new IOException("Recycle identity changed");
   var sink=new Guard{Source=source,Target=target,Delete=delete,Stamp=stamp};
   if(delete)op.DeleteItem(found,sink);
   else{Guid iid=typeof(SI).GUID;SHCreateItemFromParsingName(Path.GetDirectoryName(target),IntPtr.Zero,ref iid,out dest);op.MoveItem(found,dest,Path.GetFileName(target),sink);}
   op.PerformOperations();bool aborted;op.GetAnyOperationsAborted(out aborted);
   if(aborted || sink.Result<0)throw new IOException("Shell operation refused or incomplete: "+sink.Result.ToString("X8"));
  }finally{if(dest!=null)Marshal.ReleaseComObject(dest);if(op!=null)Marshal.ReleaseComObject(op);Marshal.ReleaseComObject(found);}
 }
}
'''


class WindowsRecycle:
    """Lazy owned STA worker; compile once, close after 20 idle seconds/at shutdown.

    Broken pipes and timeouts never replay an action. All identities cross JSON as
    decimal strings (not floating point). No helper is started during recovery.
    """
    def __init__(self):
        self.lock=threading.RLock();self.process=None;self.timer=None;self.generation=0;self.stats={'starts':0,'requests':0,'lists':0,'lease_scans':0}

    def _start(self):
        if os.name!='nt':raise OSError('回收记录操作仅支持 Windows 桌面版')
        script="$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=New-Object Text.UTF8Encoding($false); [Console]::InputEncoding=New-Object Text.UTF8Encoding($false); try { Add-Type -TypeDefinition @'\n"+CS+"\n'@; [Console]::Out.WriteLine('{\"ready\":true}'); while($null -ne ($line=[Console]::In.ReadLine())) { try { $r=$line|ConvertFrom-Json; if($r.action -eq 'list'){$v=@([RecycleBridge]::List())}elseif($r.action -eq 'prime'){$v=[RecycleBridge]::Prime([string[]]$r.paths)}elseif($r.action -in @('restore','delete')){[RecycleBridge]::Execute($r.source,$r.target,($r.action -eq 'delete'),[string[]]$r.stamp);$v=$true}else{throw 'Invalid request'}; [Console]::Out.WriteLine((ConvertTo-Json -Depth 4 -Compress -InputObject @{result=$v})) }catch{[Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @{error=$_.Exception.Message}))} }; [RecycleBridge]::Clear() }catch{[Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @{error=$_.Exception.Message})); exit 1 }"
        executable=Path(os.environ.get('SystemRoot','C:/Windows'))/'System32/WindowsPowerShell/v1.0/powershell.exe'
        self.process=subprocess.Popen([str(executable),'-NoProfile','-NonInteractive','-Sta','-EncodedCommand',base64.b64encode(script.encode('utf-16le')).decode()],
            stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True,encoding='utf-8',errors='strict',creationflags=subprocess.CREATE_NO_WINDOW)
        self.stats['starts']+=1;self.responses=queue.Queue(maxsize=2);output=self.process.stdout;responses=self.responses
        def read():
            try:
                while True:
                    line=output.readline(16*1024*1024)
                    if not line or not line.endswith('\n'):raise OSError('回收站接口已中断或响应过大')
                    responses.put(json.loads(line.lstrip('\ufeff')))
            except Exception:responses.put({'error':'回收站接口已中断，结果需核对','uncertain':True})
        threading.Thread(target=read,name='avhub-recycle-output',daemon=True).start()
        reply=self._reply()
        if not reply.get('ready'):raise OSError('回收站接口未就绪')

    def _reply(self):
        try:value=self.responses.get(timeout=60)
        except queue.Empty as error:raise UncertainRecycleError('系统回收站操作超时，结果未确认；请核对，不要重复操作') from error
        if 'error' in value:
            error_type=UncertainRecycleError if value.get('uncertain') else OSError
            raise error_type('Windows 回收站未完成操作；请核对原目录和回收记录（'+str(value['error'])[:350]+')')
        return value

    def request(self,action,source='',target='',stamp=None,paths=None):
        if action not in ('list','restore','delete','prime'):raise ValueError('Invalid recycle action')
        with self.lock:
            self.generation+=1;generation=self.generation
            if self.timer:self.timer.cancel();self.timer=None
            try:
                if not self.process or self.process.poll() is not None:self.close();self._start()
                self.stats['requests']+=1
                if action=='list':self.stats['lists']+=1
                self.process.stdin.write(json.dumps({'action':action,'source':source,'target':target,'stamp':[str(v) for v in stamp] if stamp else None,'paths':paths},ensure_ascii=False)+'\n');self.process.stdin.flush()
                result=self._reply()['result']
                if action=='prime':self.stats['lease_scans']+=int(result)
            except (BrokenPipeError,UnicodeError,ValueError,KeyError) as error:
                self.close();raise UncertainRecycleError('桥接传输失败，结果未确认；请核对，不要重复操作') from error
            except Exception:
                self.close();raise
            finally:
                if self.process:
                    def expire():
                        with self.lock:
                            if generation==self.generation:self.close()
                    self.timer=threading.Timer(20,expire);self.timer.daemon=True;self.timer.start()
            return result

    def close(self):
        with self.lock:
            if self.timer:self.timer.cancel();self.timer=None
            process=self.process;self.process=None
            if process:
                # Only the process created by this instance; never unrelated tools.
                if process.poll() is None:process.terminate()
                try:process.wait(timeout=3)
                except subprocess.TimeoutExpired:process.kill();process.wait(timeout=3)
                for stream in (process.stdin,process.stdout):
                    if stream:stream.close()

    def items(self):return self.request('list')
    def restore(self,item,target,stamp):return self.request('restore',item,str(target),stamp)
    def delete(self,item,stamp):return self.request('delete',item,stamp=stamp)
    def prime(self,paths):return self.request('prime',paths=paths)
