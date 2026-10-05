export type LibraryEntry<T>={data:T;time:number;revision:number};

export class LibraryPageCache {
  private entries=new Map<string,LibraryEntry<unknown>>();
  constructor(readonly limit=24,readonly freshMs=20000,readonly retainMs=120000){}
  get<T>(key:string,revision:number):LibraryEntry<T>|undefined {
    const entry=this.entries.get(key);
    if(!entry||entry.revision!==revision)return;
    if(Date.now()-entry.time>this.retainMs){this.entries.delete(key);return;}
    this.entries.delete(key);this.entries.set(key,entry);
    return entry as LibraryEntry<T>;
  }
  put<T>(key:string,revision:number,data:T,time=Date.now()) {
    this.entries.delete(key);this.entries.set(key,{data,time,revision});
    while(this.entries.size>this.limit)this.entries.delete(this.entries.keys().next().value!);
  }
  clear(){this.entries.clear();}
  get size(){return this.entries.size;}
}
