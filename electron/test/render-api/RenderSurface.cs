using System;
// Both candidates retain one surface until every Electron reader releases it.
interface IRenderSurface : IDisposable {
 long Frame {get;} bool AwaitingRelease {get;set;}
 int Width {get;} int Height {get;} int RedBits {get;} bool FloatingPoint {get;}
 string Handle {get;} int Fbo {get;}
 string GlDeviceLuid {get;} string AdapterLuid {get;} string AdapterMatch {get;}
 void LockForDraw();void BindForDiagnostics();void UnlockAfterDraw();
 float[] ReadDiagnosticRow();byte[] ReadDiagnosticPixel();
 SharedSurface.MemoryInfo CheckBudget(bool allocation);
}
