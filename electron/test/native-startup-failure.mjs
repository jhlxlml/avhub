import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
const require=createRequire(import.meta.url),{MpvClient}=require('../dist/mpvClient.js'),{startupFailure}=require('../dist/nativeFailure.js');
const original=new Error('原始连接失败');assert.match(startupFailure(original,new Error('清理失败')).message,/原始连接失败.*文件保护/);
assert.equal(startupFailure(startupFailure(original,new Error('first')),new Error('second')).primary,'原始连接失败');
const processModule=require('node:child_process'),savedSpawn=processModule.spawn;
try{
 const child=new EventEmitter();Object.assign(child,{pid:424242,exitCode:null,signalCode:null,stderr:{resume(){}},kill(){throw new Error('must not kill simulated process');}});
 processModule.spawn=(_file,args)=>{assert.ok(args.includes('--hr-seek=yes'),'time-pos positioning must explicitly preserve precise seeking');return child;};
 const client=new MpvClient(()=>{},()=>{}),starting=client.start('test-only','never-read','0',0);
 child.emit('error',new Error('模拟终止错误'));
 assert.equal(client.closed,false,'an error on a spawned process is not exit confirmation');
 child.exitCode=0;child.emit('exit',0);await assert.rejects(starting);
}finally{processModule.spawn=savedSpawn;}
const client=new MpvClient(()=>{},()=>{});let kills=0;
client.child={pid:424243,exitCode:null,signalCode:null,kill(){kills++;return false;}};client.exited=new Promise(()=>{});client.command=async()=>null;
const stopping=client.stop();assert.equal(client.stop(),stopping,'concurrent teardown is shared');
await assert.rejects(stopping,/仍未退出/);assert.equal(kills,1);assert.equal(client.closed,false,'exit timeout retains ownership');
client.child.exitCode=0;await client.stop();assert.equal(client.closed,true,'later confirmed exit permits retry cleanup');
console.log('Native startup failure passed: primary error, kill-error safety, shared stop, retained ownership and retry.');
