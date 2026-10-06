import {existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync,renameSync,unlinkSync,readdirSync,realpathSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
export type DataMigration={id:string;source:string;target:string};
export type DataLocationConfig={version:1;directory:string;pending?:DataMigration};
export const configName='avhub-data-location.json';
function absolute(value:unknown):value is string {return typeof value==='string'&&value.length<32768&&!/[\x00-\x1f]/.test(value)&&path.isAbsolute(value);}
export function readDataLocation(file:string):DataLocationConfig|null {
  if(!existsSync(file))return null;
  const stat=lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw new Error('数据目录配置不可读取，请检查 avhub-data-location.json');
  const value=JSON.parse(readFileSync(file,'utf8'));
  if(value.version!==1||!absolute(value.directory))throw new Error('数据目录配置无效');
  if(value.pending&&(!/^[a-f0-9-]{36}$/.test(value.pending.id)||!absolute(value.pending.source)||value.pending.target!==value.directory))throw new Error('数据迁移配置无效');
  return value;
}
export function writeDataLocation(file:string,value:DataLocationConfig) {
  if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw new Error('不能覆盖链接形式的数据配置');
  const temp=file+'.'+randomUUID()+'.tmp';
  try {writeFileSync(temp,JSON.stringify(value,null,2),{flag:'wx'});renameSync(temp,file);}
  finally {if(existsSync(temp))unlinkSync(temp);}
}
export function writableDirectory(directory:string) {
  mkdirSync(directory,{recursive:true});const probe=path.join(directory,'.avhub-write-'+randomUUID());
  try {writeFileSync(probe,'',{flag:'wx'});}finally {if(existsSync(probe))unlinkSync(probe);}
  return realpathSync(directory);
}
export function migrationConfig(source:string,target:string):DataLocationConfig {
  source=realpathSync(source);target=writableDirectory(target);
  const relation=path.relative(source,target),reverse=path.relative(target,source);
  if(!relation)return {version:1,directory:source};
  if((!relation.startsWith('..'+path.sep)&&relation!=='..'&&!path.isAbsolute(relation))||(!reverse.startsWith('..'+path.sep)&&reverse!=='..'&&!path.isAbsolute(reverse)))throw new Error('新旧数据目录不能相互包含');
  if(readdirSync(target).length)throw new Error('请选择空目录，以免覆盖已有文件');
  return {version:1,directory:target,pending:{id:randomUUID(),source,target}};
}
