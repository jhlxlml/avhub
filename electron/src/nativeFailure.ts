// Preserve the original startup failure if safe teardown also fails.
export class NativeStartupFailure extends Error {
  constructor(readonly primary:string,readonly cleanupPending:boolean){
    super(`${primary}${cleanupPending?'；原生进程尚未确认退出，文件保护已保留。可重试清理，确认退出后才能重新播放或切换播放器。':''}`);
  }
}
export function startupFailure(error:unknown,cleanup?:unknown){
  const primary=error instanceof NativeStartupFailure?error.primary:error instanceof Error?error.message:'原生播放启动失败，请重试';
  return new NativeStartupFailure(primary,cleanup!==undefined);
}
