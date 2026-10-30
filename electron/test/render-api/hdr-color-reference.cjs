// Independent CPU reference derived from primary chromaticities, not WGSL coefficients.
const {pqEncode,pqDecodeExtended}=require('./hdr-math.cjs');
const colors=Object.freeze([[0,0,0],[203,203,203],[1000,1000,1000],[1000,0,0],[0,1000,0],[0,0,1000],[0,1000,1000],[1000,0,1000],[1000,1000,0],[10000,10000,10000]].map(Object.freeze));
function inverse(m){const [a,b,c]=m[0],[d,e,f]=m[1],[g,h,i]=m[2],det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);if(!Number.isFinite(det)||Math.abs(det)<1e-12)throw new Error('Singular primary matrix');return [[e*i-f*h,c*h-b*i,b*f-c*e],[f*g-d*i,a*i-c*g,c*d-a*f],[d*h-e*g,b*g-a*h,a*e-b*d]].map(row=>row.map(v=>v/det));}
const vector=(m,v)=>m.map(row=>row.reduce((sum,n,i)=>sum+n*v[i],0));
function primaries(p){const columns=p.map(([x,y])=>[x/y,1,(1-x-y)/y]),m=[0,1,2].map(r=>columns.map(c=>c[r])),white=[.3127/.329,1,(1-.3127-.329)/.329],scale=vector(inverse(m),white);return m.map(row=>row.map((v,c)=>v*scale[c]));}
const toXYZ=primaries([[.708,.292],[.170,.797],[.131,.046]]),fromXYZ=inverse(primaries([[.64,.33],[.30,.60],[.15,.06]]));
function bt2020To709(rgb){if(rgb.length!==3||!rgb.every(Number.isFinite))throw new Error('Invalid RGB reference');return vector(fromXYZ,vector(toXYZ,rgb));}
function encodeYuv(nits){const [r,g,b]=nits.map(pqEncode),y=.2627*r+.678*g+.0593*b;return [64+Math.round(876*y),512+Math.round(896*(b-y)/(2*(1-.0593))),512+Math.round(896*(r-y)/(2*(1-.2627)))];}
function decodeYuv([y,u,v]){const l=(y-64)/876,cb=(u-512)/896,cr=(v-512)/896,r=l+2*(1-.2627)*cr,b=l+2*(1-.0593)*cb,g=(l-.2627*r-.0593*b)/.678;return [r,g,b];}
function frame(width,height){if(width!==1024||height!==256)throw new Error('Unverified fixture size');const yuv=colors.map(encodeYuv),data=Buffer.alloc(width*height*3);for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.writeUInt16LE(yuv[Math.min(9,Math.floor(x*10/width))][0],2*(y*width+x));const pixels=width*height;for(let c=0;c<2;c++)for(let y=0;y<height/2;y++)for(let x=0;x<width/2;x++)data.writeUInt16LE(yuv[Math.min(9,Math.floor(x*20/width))][c+1],2*(pixels+c*pixels/4+y*width/2+x));return data;}
module.exports={colors,encodeYuv,decodeYuv,bt2020To709,frame,pqDecodeExtended};
