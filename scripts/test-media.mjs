// Local fixture preparation/catalogue, never a product package or media editor.
import {sharedMedia} from '../electron/test/media-pool.mjs';
const [action='list',profile,source]=process.argv.slice(2),pool=sharedMedia();
if(action==='list')console.log(JSON.stringify(pool.list(),null,2));
else if(action==='prepare')console.log(pool.get(profile));
else if(action==='adopt-generated'){if(!source)throw new Error('Expected profile and owned generated path');console.log(pool.adopt(profile,source));}
else if(action==='import'){if(!profile)throw new Error('Expected original read-only path');console.log(pool.imported(profile));}
else throw new Error('Expected list / prepare PROFILE / adopt-generated PROFILE PATH / import PATH');
