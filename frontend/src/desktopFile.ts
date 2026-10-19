import {requireDesktop} from './nativeDesktop';
export async function desktopFile(value:Parameters<NonNullable<NonNullable<Window['avhubDesktop']>['fileOperation']>>[0]){
  const desktop=requireDesktop('fileOperation');
  if(!desktop.fileOperation)throw new Error('请重启已更新的桌面组件');
  return desktop.fileOperation(value);
}
