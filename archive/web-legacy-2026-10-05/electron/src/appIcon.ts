import { nativeImage, type NativeImage } from 'electron';
import path from 'node:path';

export function desktopIconPath(projectRoot: string, resourcesPath: string, packaged: boolean): string {
  return packaged
    ? path.join(resourcesPath, 'icons', 'avhub.png')
    : path.join(projectRoot, 'electron', 'assets', 'avhub.png');
}

export function loadDesktopIcon(projectRoot: string, resourcesPath: string, packaged: boolean): NativeImage {
  const filename = desktopIconPath(projectRoot, resourcesPath, packaged);
  const icon = nativeImage.createFromPath(filename);
  if (icon.isEmpty()) throw new Error(`无法加载 AVHub 应用图标：${filename}`);
  return icon;
}
