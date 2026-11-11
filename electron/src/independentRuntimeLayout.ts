import {existsSync} from 'node:fs';
import path from 'node:path';

/** Explicit development candidate; installed desktop layout is unchanged. */
export function independentRuntimeLayout(root:string,packaged:boolean,resources:string,candidate=process.env.AVHUB_MPV_RUNTIME_CANDIDATE){
 if(!packaged&&candidate&&!/^mpv-desktop-runtime-[a-z0-9_]{8}$/.test(candidate))throw new Error('无效独立 MPV 开发运行库目录');
 const folder=packaged?path.join(resources,'mpv'):candidate?path.join(root,'build',candidate):path.join(root,'bin/mpv');
 const manifest=path.join(folder,'runtime.json');
 return {executable:path.join(folder,'mpv.exe'),manifest:!packaged&&candidate||packaged&&existsSync(manifest)?manifest:undefined};
}
