// Test-owned Electron entry. No production fault-injection flag or code rewrite.
const {app}=require('electron');
const Module=require('node:module');
const fs=require('node:fs');
const path=require('node:path');
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const main=path.join(config.root,'electron','dist','main.js');
const result={case:config.case,backendPid:null,descendantPid:null,windowAttempts:0,errorDialogs:0,willQuit:false};
const persist=()=>fs.writeFileSync(config.result,JSON.stringify(result,null,2));
app.on('will-quit',()=>{result.willQuit=true;persist();});
const load=Module._load;
Module._load=function(request,parent,isMain){
 const original=load.apply(this,arguments);
 if(parent?.filename!==main)return original;
 if(request==='electron')return new Proxy(original,{get(target,key){
  // The test entry lives under electron/test, not the application's package.
  // Keep production's resource/cwd resolution identical to `electron .`.
  if(key==='app')return new Proxy(target.app,{get(owner,name){
   if(name==='getAppPath')return()=>config.root;
   const value=Reflect.get(owner,name);return typeof value==='function'?value.bind(owner):value;
  }});
  if(key==='dialog')return {...target.dialog,showErrorBox(){result.errorDialogs++;persist();}};
  if(key==='BrowserWindow')return new Proxy(target.BrowserWindow,{construct(){result.windowAttempts++;persist();throw new Error('Owned window creation failure');}});
  return Reflect.get(target,key);
 }});
 if(request==='node:child_process')return {...original,spawn(executable,args,options){
  let child;
  if(config.case==='timeout-tree'){
   // A real owned child and descendant deliberately expose no health endpoint.
   // Keep the parent alive until production's bounded tree termination runs.
   const script=`const{spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{env:process.env,windowsHide:true,stdio:'ignore'});console.log('owned-descendant='+c.pid);setInterval(()=>{},1000);`;
   child=original.spawn(process.execPath,['-e',script],{...options,env:{...options.env,ELECTRON_RUN_AS_NODE:'1'}});
  }else child=original.spawn(executable,args,options);
  result.backendPid=child.pid??null;persist();
  child.stdout?.on('data',data=>{const match=/owned-descendant=(\d+)/.exec(data.toString());if(match){result.descendantPid=Number(match[1]);persist();}});
  return child;
 }};
 return original;
};
persist();require(main);
