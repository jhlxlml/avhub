// Keep API/URL sort keys compatible; the UI exposes each field only once.
export const librarySorts = [
  {id:'recent',label:'观看时间',asc:'recent_asc',desc:'recent',ascending:'较早观看优先',descending:'最近观看优先'},
  {id:'added',label:'添加时间',asc:'added_asc',desc:'added',ascending:'较早添加优先',descending:'最近添加优先'},
  {id:'modified',label:'文件修改时间',asc:'modified_asc',desc:'modified_desc',ascending:'较早修改优先',descending:'最近修改优先'},
  {id:'name',label:'名称',asc:'name',desc:'name_desc',ascending:'名称 A–Z',descending:'名称 Z–A'},
  {id:'duration',label:'时长',asc:'duration_asc',desc:'duration_desc',ascending:'从短到长',descending:'从长到短'},
  {id:'resolution',label:'分辨率',asc:'resolution_asc',desc:'resolution_desc',ascending:'从低到高',descending:'从高到低'},
  {id:'size',label:'文件大小',asc:'size_asc',desc:'size_desc',ascending:'从小到大',descending:'从大到小'},
] as const;
export function sortField(key:string) {
  return librarySorts.find(s=>s.asc===key||s.desc===key) || librarySorts[1];
}
export function isAscending(key:string) {return sortField(key).asc===key;}
export function validSort(key:string|null) {return librarySorts.some(s=>s.asc===key||s.desc===key);}
