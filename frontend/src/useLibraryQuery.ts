import {useCallback,useEffect,useRef,useState} from 'react';
import {api,errorText} from './api';
import {LibraryPageCache} from './libraryCache';
export {LibraryPageCache} from './libraryCache';

type Snapshot<T>={url:string;revision:number;data?:T;error:string;pending:boolean};
// Only a matching query may supply content. A slow old response can never
// relabel another classification, directory or search result as current.
export function useLibraryQuery<T>(url:string|null,revision:number,cache:LibraryPageCache,search:string,retry=0) {
  const [snapshot,setSnapshot]=useState<Snapshot<T>|null>(null);
  const [feedback,setFeedback]=useState('');
  const previousSearch=useRef(search);
  const active=useRef({url,revision});active.current={url,revision};
  const cached=url?cache.get<T>(url,revision):undefined;
  const matches=!!url&&snapshot?.url===url&&snapshot.revision===revision;
  const data=url?(matches?snapshot?.data:cached?.data):undefined;
  const loading=!!url&&(matches?snapshot!.pending:!cached||Date.now()-cached.time>cache.freshMs);
  const error=matches?snapshot!.error:'';
  const identity=`${revision}:${url}`;
  useEffect(()=>{
    const typing=previousSearch.current!==search;previousSearch.current=search;
    if(!url)return;
    const entry=cache.get<T>(url,revision);
    if(entry&&Date.now()-entry.time<=cache.freshMs) {
      setSnapshot({url,revision,data:entry.data,error:'',pending:false});return;
    }
    const controller=new AbortController();
    setSnapshot({url,revision,data:entry?.data,error:'',pending:true});
    const load=async()=>{
      try {
        const result=await api<T>(url,{signal:controller.signal});
        if(controller.signal.aborted)return;
        cache.put(url,revision,result);
        setSnapshot({url,revision,data:result,error:'',pending:false});
      }catch(e){if(!controller.signal.aborted)setSnapshot({url,revision,data:entry?.data,error:errorText(e),pending:false});}
    };
    // Classification, pagination and directory changes are immediate. Only
    // text editing needs debounce; never apply it to every query transition.
    const timer=typing?window.setTimeout(()=>void load(),200):undefined;
    if(!typing)void load();
    return()=>{controller.abort();if(timer!==undefined)clearTimeout(timer);};
  },[url,revision,cache,search,retry]);
  useEffect(()=>{
    setFeedback('');
    if(!loading)return;
    const timer=window.setTimeout(()=>setFeedback(identity),180);
    return()=>clearTimeout(timer);
  },[identity,loading]);
  const update=useCallback((change:(value:T|undefined)=>T|undefined)=>{
    setSnapshot(current=>{
      const {url:key,revision:version}=active.current;
      if(!key)return current;
      const valid=current?.url===key&&current.revision===version;
      const entry=cache.get<T>(key,version);
      const next=change(valid?current.data:entry?.data);
      if(next===undefined)return current;
      cache.put(key,version,next,entry?.time);
      return {url:key,revision:version,data:next,error:valid?current.error:'',pending:valid?current.pending:false};
    });
  },[cache]);
  return {data,loading,error,showLoading:loading&&feedback===identity,update};
}
