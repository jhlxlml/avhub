import {confirmInApp} from './AppConfirm';
// Keep explicit consequences; confirmation is themed and cancellation is default.
export function confirmAction(title:string,details:string,consequence:string){
  return confirmInApp(title,details,consequence,'确认',true);
}
