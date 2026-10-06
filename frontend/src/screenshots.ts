import { api } from './api';
import {requireDesktop} from './nativeDesktop';

export type ScreenshotPreference = {directory:string;shortcut:'C'};
export type ScreenshotSettings = ScreenshotPreference & {effective_directory:string;default_directory:string;available:boolean;warning:string};
export type SavedScreenshot = {id:string;filename:string;path:string;directory:string;width:number;height:number;time:number;bytes:number};
const captures=new Set<Promise<boolean>>();
export function trackScreenshot(task:Promise<boolean>) {
  captures.add(task);void task.finally(()=>captures.delete(task));
}
// Captures continue safely when advancing to the next video. Quit still waits
// for them even if the Player that created the request has already unmounted.
window.addEventListener('avhub-before-quit',event=>(event as CustomEvent<Promise<unknown>[]>).detail.push(...captures));
export const screenshotShortcutLabel=()=>'C';
export function screenshotKey(event:KeyboardEvent) {
  return event.code==='KeyC'&&!event.shiftKey;
}
export async function revealScreenshot(id?:string) {
  await requireDesktop('screenshotAction').screenshotAction(id??null,id?'reveal':'folder');
}
export async function saveScreenshot(mediaId:number,point:number,blob:Blob,captureId:string):Promise<SavedScreenshot> {
  return api(`/api/media/${mediaId}/screenshot?time=${point}&capture_id=${captureId}`,{method:'POST',headers:{'Content-Type':'image/png'},body:blob});
}
