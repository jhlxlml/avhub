// Only Electron's isolated preload grants native capabilities.
export function requireDesktop(method:keyof NonNullable<Window['avhubDesktop']>) {
  const desktop=window.avhubDesktop;
  if(!desktop||typeof desktop[method]!=='function')throw new Error('桌面组件尚未就绪，请通过 AVHub 桌面入口重新启动应用');
  return desktop;
}
