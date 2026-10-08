import {type ReactNode} from 'react';
import {Icon} from './Icon';
import './library-refinement.css';

export function LibraryHeading({title,filters,count,updating=false}:{title:string;filters:ReactNode;count:string;updating?:boolean}) {
  return <div className="section-title library-heading">
    <h2>{title}</h2>
    {filters}
    <div className="library-heading-status">
      {count&&<span className="library-result-count">{count}</span>}
      {updating&&<span className="library-query-feedback" role="status"><Icon name="refresh" size={14} className="is-spinning"/>更新中</span>}
    </div>
  </div>;
}
