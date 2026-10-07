import {type Page} from '@playwright/test';

// Explicit shared-renderer harness: browser downloads stand in for native saves
// only inside this test helper. Desktop acceptance lives in library-workflows.mjs.
export async function installExportHarness(page:Page){
  await page.addInitScript(()=>{
    const state={purePlayback:false,alwaysOnTop:false,maximized:false,fullScreen:false};
    (window as any).avhubDesktop={
      getWindowState:async()=>state,setWindowMode:async()=>state,onWindowStateChanged:()=>()=>{},windowAction:async()=>state,
      saveExport:async(value:{kind:string;jobId?:string})=>{
        const response=await fetch(value.kind==='backup'?`/api/data-jobs/${value.jobId}/download`:'/api/diagnostics');
        if(!response.ok)throw new Error('Harness export failed');
        const blob=await response.blob();const url=URL.createObjectURL(blob),link=document.createElement('a');
        const filename=value.kind==='diagnostics'?'avhub-diagnostics.json':blob.type.includes('zip')?'avhub-library.zip':'avhub-backup.db';
        link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
        return {id:'renderer-harness',path:filename,bytes:blob.size};
      },cancelExport:async()=>({ok:true}),revealExport:async()=>({ok:true}),
    };
  });
}
