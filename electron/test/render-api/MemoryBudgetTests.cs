// Real policy unit tests, not GPU-pressure or device-lost acceptance.
using System;
static class MemoryBudgetTests {
 const ulong MiB=1024*1024,Surface=3840UL*2160*8*3;
 static void Reject(ulong budget,ulong used,ulong estimate,bool allocation){try{SharedSurface.ValidateBudget(new SharedSurface.MemoryInfo{Budget=budget,CurrentUsage=used},estimate,allocation);}catch(Exception){return;}throw new Exception("Unsafe budget accepted");}
 public static int Main(){try{
  SharedSurface.ValidateBudget(new SharedSurface.MemoryInfo{Budget=2048*MiB,CurrentUsage=256*MiB},Surface,true);
  Reject(0,0,Surface,true);Reject(2048*MiB,2049*MiB,Surface,false);
  Reject(512*MiB,0,Surface,true);Reject(2048*MiB,1800*MiB,Surface,true);
  Reject(2048*MiB,0,257*MiB,true);Reject(2048*MiB,2049*MiB,Surface,true);
  SharedSurface.ValidateBudget(new SharedSurface.MemoryInfo{Budget=2048*MiB,CurrentUsage=2048*MiB},Surface,false);
  Console.WriteLine("8 native memory policy checks passed; no GPU-pressure claim");return 0;
 }catch(Exception error){Console.Error.WriteLine(error);return 1;}}
}
