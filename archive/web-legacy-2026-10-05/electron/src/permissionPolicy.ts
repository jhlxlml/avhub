export function permissionAllowed(permission: string, requestingUrl: string, origin: string, isMainFrame: boolean): boolean {
  if (!['fullscreen', 'clipboard-sanitized-write'].includes(permission) || !isMainFrame) return false;
  try { return new URL(requestingUrl).origin === origin; }
  catch { return false; }
}
