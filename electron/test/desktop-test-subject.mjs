// Reads the actual launched application's metadata and bytes. Never takes
// package/build identity from the caller's checkout for a packaged test.
import path from 'node:path';import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=path.resolve(import.meta.dirname,'../..'),proof=createRequire(import.meta.url)('../release-evidence.cjs');
export async function desktopTestSubject(desktop,script){
 const value=await desktop.evaluate(({app},helper)=>{
  const require=process.getBuiltinModule('node:module').createRequire(app.getAppPath()+'/package.json'),fs=require('node:fs'),path=require('node:path'),proof=require(helper),appRoot=app.getAppPath(),resources=process.resourcesPath;
  const metadata=JSON.parse(fs.readFileSync(path.join(appRoot,'app/build-info.json'),'utf8')),packaged=app.isPackaged;
  return {schema:1,kind:packaged?'packaged-desktop':'source-desktop',version:app.getVersion(),buildId:metadata.build_id,payloadSha256:proof.compiledPayload(appRoot,packaged?path.join(resources,'backend/_internal/app/static'):path.join(appRoot,'app/static')),resources,exe:process.execPath,asar:appRoot,markerPurpose:packaged&&fs.existsSync(path.join(resources,'native-render-desktop.json'))?JSON.parse(fs.readFileSync(path.join(resources,'native-render-desktop.json'),'utf8')).purpose:null};
 },path.join(root,'electron/release-evidence.cjs'));
 const subject={schema:value.schema,kind:value.kind,version:value.version,buildId:value.buildId,payloadSha256:value.payloadSha256,markerPurpose:value.markerPurpose,testScript:{path:path.relative(root,fileURLToPath(script)).replaceAll('\\','/'),sha256:proof.hash(fileURLToPath(script)),collectorSha256:proof.hash(fileURLToPath(import.meta.url))}};
 if(value.kind==='packaged-desktop')Object.assign(subject,{applicationExeSha256:proof.hash(value.exe),applicationAsarSha256:proof.hash(value.asar),files:proof.packagedFiles(value.resources)});
 return subject;
}
