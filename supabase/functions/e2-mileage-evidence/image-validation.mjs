export const MAX_IMAGE_BYTES=5*1024*1024;
export const MAX_IMAGE_SIDE=8192;
export const MAX_IMAGE_PIXELS=16*1024*1024;
const invalid='Photo content does not match its JPEG, PNG or WebP type.';
const dimensions='Image dimensions are outside the supported range.';
const fail=()=>{throw Error(invalid);};
function bounds(w,h){if(!w||!h||w>MAX_IMAGE_SIDE||h>MAX_IMAGE_SIDE||w*h>MAX_IMAGE_PIXELS)throw Error(dimensions);return {w,h};}
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc(bytes,start,end){let n=0xffffffff;for(let i=start;i<end;i++)n=crcTable[(n^bytes[i])&255]^(n>>>8);return (n^0xffffffff)>>>0;}

// These bounded container checks run BEFORE the pixel decoder allocates memory.
// They reject incomplete containers and animations; they do not prove decodability.
function container(bytes,mime){
 const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),len=bytes.length;
 const eq=(p,a)=>a.every((x,i)=>bytes[p+i]===x),tag=p=>String.fromCharCode(...bytes.subarray(p,p+4));
 if(mime==='image/png'&&eq(0,[137,80,78,71,13,10,26,10])){
  let p=8,size,idat=false;
  while(p+12<=len){const n=v.getUint32(p),t=tag(p+4),end=p+12+n;if(end>len||crc(bytes,p+4,end-4)!==v.getUint32(end-4))fail();
   if(p===8){if(t!=='IHDR'||n!==13)fail();size=bounds(v.getUint32(p+8),v.getUint32(p+12));}
   else if(t==='IHDR')fail();
   if(['acTL','fcTL','fdAT'].includes(t))fail();
   if(t==='IDAT')idat=true;
   if(t==='IEND'){if(n||!idat||end!==len)fail();return {...size,format:'Png'};}
   p=end;
  }fail();
 }
 if(mime==='image/jpeg'&&eq(0,[255,216])){
  let p=2,size,scans=0;
  while(p<len){if(bytes[p++]!==255)fail();while(bytes[p]===255)p++;const marker=bytes[p++];
   if(marker===217){if(p!==len||!size||!scans)fail();return {...size,format:'Jpeg'};}
   if(marker===0||marker===216||marker===1||(marker>=208&&marker<=215)||p+2>len)fail();
   const n=v.getUint16(p);if(n<2||p+n>len)fail();
   if([192,193,194].includes(marker)){if(size||n<8)fail();size=bounds(v.getUint16(p+5),v.getUint16(p+3));}
   else if(marker>=192&&marker<=207&&![196,200,204].includes(marker))fail();
   p+=n;
   if(marker===218){if(!size)fail();scans++;
    // Walk the entire entropy stream, allowing byte stuffing and restart markers.
    for(;;){if(p>=len)fail();if(bytes[p]!==255){p++;continue;}let q=p+1;while(bytes[q]===255)q++;if(q>=len)fail();if(bytes[q]===0||(bytes[q]>=208&&bytes[q]<=215)){p=q+1;continue;}break;}
   }
  }fail();
 }
 if(mime==='image/webp'&&len>=20&&tag(0)==='RIFF'&&tag(8)==='WEBP'&&v.getUint32(4,true)===len-8){
  let p=12,size,canvas,images=0;
  const u24=p=>bytes[p]|bytes[p+1]<<8|bytes[p+2]<<16;
  while(p+8<=len){const t=tag(p),n=v.getUint32(p+4,true),data=p+8,end=data+n;if(end>len||end+(n&1)>len)fail();
   if(t==='VP8X'){if(p!==12||n!==10||(bytes[data]&2))fail();canvas=bounds(u24(data+4)+1,u24(data+7)+1);}
   if(t==='ANIM'||t==='ANMF')fail();
   if(t==='VP8 '){if(n<10||(bytes[data]&1)||!eq(data+3,[157,1,42]))fail();size=bounds(v.getUint16(data+6,true)&16383,v.getUint16(data+8,true)&16383);images++;}
   if(t==='VP8L'){if(n<5||bytes[data]!==47)fail();const bits=v.getUint32(data+1,true);size=bounds((bits&16383)+1,((bits>>>14)&16383)+1);images++;}
   p=end+(n&1);
  }
  if(p!==len||images!==1||!size||(canvas&&(canvas.w!==size.w||canvas.h!==size.h)))fail();return {...size,format:'WebP'};
 }
 fail();
}

// The caller supplies the initialized, pinned WASM module, never a request value.
export function createImageInspector({MagickImage,MagickReadSettings,MagickFormat,ResourceLimits}){
 ResourceLimits.width=BigInt(MAX_IMAGE_SIDE);ResourceLimits.height=BigInt(MAX_IMAGE_SIDE);
 // The reader needs transient internal images even for one static frame.
 ResourceLimits.area=BigInt(MAX_IMAGE_PIXELS);ResourceLimits.listLength=4n;
 ResourceLimits.memory=128n*1024n*1024n;ResourceLimits.disk=0n;
 ResourceLimits.maxMemoryRequest=128n*1024n*1024n;ResourceLimits.maxProfileSize=1024n*1024n;ResourceLimits.time=2n;
 return function inspectImage(bytes,mime){
  if(!(bytes instanceof Uint8Array)||!bytes.length||bytes.length>MAX_IMAGE_BYTES)throw Error('Choose an image up to 5 MiB.');
  const expected=container(bytes,mime),image=MagickImage.create();
  try{
   let warned=false;image.onWarning=()=>{warned=true;};
   // read(), not ping(): decode the complete image with an explicitly forced coder.
   image.read(bytes,new MagickReadSettings({format:MagickFormat[expected.format]}));
   if(warned||image.width!==expected.w||image.height!==expected.h)fail();
   bounds(image.width,image.height);
   // Access the last decoded pixel without copying the full pixel buffer into JS.
   image.getPixels(pixels=>{if(!pixels.getPixel(image.width-1,image.height-1).length)fail();});
   if(warned)fail();return mime;
  }catch{throw Error(invalid);}finally{image.dispose();}
 };
}
