import {desktopFile} from './desktopFile';
export type RecycledNotice={records:{id:string;title:string}[]};
export function announceRecycled(records:RecycledNotice['records']){
  const valid=records.filter(item=>/^[a-f0-9]{32}$/.test(item.id));
  if(valid.length)window.dispatchEvent(new CustomEvent<RecycledNotice>('avhub-recycled',{detail:{records:valid}}));
}
// Same native preflight and exact-identity restore as the full record view.
// Never infer the last deleted file from title, path or current list position.
export async function restoreRecordedVideo(id:string){
  if(!/^[a-f0-9]{32}$/.test(id))throw new Error('回收记录标识无效');
  let token='';
  try{
    const preview=await desktopFile({action:'preview-records',recordIds:[id],recordAction:'restore'});
    token=preview.preview_token||'';const records=preview.records;
    if(!token||!records||records.length!==1||records[0].id!==id||records[0].action!=='restore')throw new Error('恢复预览不一致，请打开回收记录核对');
    if(!records[0].eligible)throw new Error(records[0].reason||'此记录暂不能恢复，请核对结果');
    const result=await desktopFile({action:'restore-record',id,confirmed:false,previewToken:token});
    if(!result.ok)throw new Error('恢复结果未确认，请打开回收记录核对，不要重复操作');
    window.dispatchEvent(new Event('avhub-file-states-changed'));
    return result;
  }finally{if(token)await desktopFile({action:'release-record-preview',previewToken:token}).catch(()=>{});}
}
