// Pure failure-classification checks; real handoff/budget uses Electron UI E2E.
import {test} from 'node:test';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);execFileSync(process.execPath,['node_modules/typescript/bin/tsc','--ignoreConfig','--noCheck','--target','ES2022','--module','Node16','--moduleResolution','Node16','--outDir','build/native-recovery-contract','frontend/src/playback/nativeRecovery.ts'],{cwd:new URL('../..',import.meta.url),windowsHide:true});const {mayReturnAfterNativeOpenFailure:allowed,isNativeColorMetadataRejection:unverifiedColor}=require('../../build/native-recovery-contract/nativeRecovery.js');
test('only known initialization may return; integrity failure remains visible',()=>{assert.equal(allowed('原生渲染宿主未能启动'),true);assert.equal(allowed('原生嵌入运行库未通过完整性校验'),false);});
test('source, persistence, cleanup and unknown errors never trigger automatic engine changes',()=>{for(const message of ['视频文件不存在','源视频已变化，请刷新索引后再启动原生播放','此视频尚不属于已验证的原生嵌入 SDR 范围，请使用现有原画链路；不会降画质或假定色彩','原生打开失败且清理尚未完成，请重试关闭','播放记录尚未保存，请重试关闭','原生画面设备异常，请重试或切换现有播放器','MPV_END_FILE:-13','','未知错误','错误中包含：原生渲染宿主未能启动'])assert.equal(allowed(message),false,message);});

test('only the complete trusted missing-colour refusal permits default-engine recovery',()=>{
 const refusal='视频缺少色域、传递函数、色彩矩阵、色彩范围标记，无法验证原生色彩；不代表视频损坏或运行库缺失。请点击“切换现有播放器”尝试原文件直放；不会补写色彩、转码或降低画质';
 assert.equal(unverifiedColor(refusal),true);
 for(const message of ['未知错误：'+refusal,refusal+'；清理尚未完成','视频文件不存在','播放记录尚未保存','色彩或像素格式不在已验证范围内','视频缺少编码标记，无法验证原生色彩'])assert.equal(unverifiedColor(message),false,message);
 assert.equal(allowed(refusal),false,'this is not a runtime initialization exception');
});

test('known render-path admission failures may recover, save/lease failures may not',()=>{
 const {isNativePathUnavailable}=require('../../build/native-recovery-contract/nativeRecovery.js');
 assert.equal(isNativePathUnavailable('当前嵌入播放路径不可用：完整画面超过 D3D11 单张纹理尺寸上限。可切换其他原画播放路径；不会自动转码或降低画质'),true);
 for(const error of ['源视频已变化，请刷新索引后再启动原生播放','播放进度保存失败','原生播放器仍未退出，保留文件占用保护'])assert.equal(isNativePathUnavailable(error),false);
});

test('typed classifications override misleading text and provide actionable guidance',()=>{
 const {classifyNativeFailure,isNativePathUnavailable}=require('../../build/native-recovery-contract/nativeRecovery.js');
 const {PlaybackSessionFailure:Failure}=require('../../build/native-recovery-contract/PlaybackSessionCoordinator.js');
 for(const kind of ['integrity','device-lost','unauthorized','source-invalid','media-offline','backend-aborted','save','cleanup','unknown']){
  const error=new Failure(kind,'原生渲染宿主未能启动','open');assert.equal(classifyNativeFailure(error),kind);assert.equal(allowed(error),false);assert.equal(isNativePathUnavailable(error),false);assert.ok(error.recoveryHint.length>8);
 }
 for(const message of ['原生渲染宿主已退出','原生渲染构建信息不完整','原生渲染构建清单无效','原生渲染运行库文件无效','原生渲染源码已有变化，请重新编译宿主','错误中包含：原生渲染宿主未能启动'])assert.equal(isNativePathUnavailable(message),false,message);
 assert.equal(classifyNativeFailure('视频文件不存在'),'media-offline');assert.equal(classifyNativeFailure('播放记录尚未保存，请重试关闭'),'save');assert.equal(allowed(new Failure('runtime-missing','missing DLL','open')),true);
});
