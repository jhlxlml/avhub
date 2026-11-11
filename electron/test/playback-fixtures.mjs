// One versioned, checksum-verified source per reusable profile.
import assert from 'node:assert/strict';
import path from 'node:path';
import {sharedMedia} from './media-pool.mjs';

export function playbackFixture(kind){
 assert.ok(['basic','hevc4k','transport8','longGop38','transport38','transportLong38'].includes(kind));
 const explicit=kind==='basic'?process.env.AVHUB_TEST_BASIC_SOURCE:kind==='hevc4k'?process.env.AVHUB_TEST_HEVC_SOURCE:undefined;
 if(explicit){assert.ok(path.isAbsolute(explicit),'Explicit fixture path must be absolute');if(path.resolve(explicit).startsWith(sharedMedia().root+path.sep))return sharedMedia().checked(explicit);return sharedMedia().imported(explicit);}
 return sharedMedia().get(kind);
}
