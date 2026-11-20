// The cache holds only bytes, never publication/access decisions. Callers must
// validate current Drive metadata and vehicle/photo relations on every request.
export function jpegDimensions(bytes) {
  if(bytes[0]!==255||bytes[1]!==216)return null;
  let p=2;
  while(p+3<bytes.length){
    if(bytes[p++]!==255)return null;
    while(bytes[p]===255)p++;
    const marker=bytes[p++];if(marker===217||marker===218)return null;
    if(marker===1||(marker>=208&&marker<=215))continue;
    const size=(bytes[p]<<8)|bytes[p+1];if(size<2||p+size>bytes.length)return null;
    if([192,193,194].includes(marker)&&size>=8)return {width:(bytes[p+5]<<8)|bytes[p+6],height:(bytes[p+3]<<8)|bytes[p+4]};
    p+=size;
  }
  return null;
}
export function createImageVariants({convert,now=Date.now,maxBytes=24*1024*1024,ttl=300000}) {
  const cache=new Map();let used=0;
  return async function variant({key,width,mime,load}) {
    if(![400,800,1280].includes(width))throw Error('Invalid image width');
    for(const [k,v] of cache)if(v.until<=now()){cache.delete(k);used-=v.bytes.length;}
    const cacheKey=key+':'+width;
    if(cache.has(cacheKey)){const value=cache.get(cacheKey);cache.delete(cacheKey);cache.set(cacheKey,value);return value;}
    const original=await load();let result={bytes:original,mime};
    const dimensions=mime==='image/jpeg'&&original.length<=3*1024*1024?jpegDimensions(original):null;
    // Full-size displays retain the original pixels and avoid WASM cold-start cost.
    // Only create a derivative when the requested size actually reduces the image.
    if(dimensions?.width>width&&dimensions.height>0&&dimensions.width*dimensions.height<=4000000){
      try{const bytes=await convert(original,width);if(bytes?.length>0&&bytes.length<original.length)result={bytes,mime:'image/webp'};}catch{/* Keep the verified original available if conversion fails. */}
    }
    if(result.bytes.length<=maxBytes){
      while(used+result.bytes.length>maxBytes&&cache.size){const oldest=cache.keys().next().value;used-=cache.get(oldest).bytes.length;cache.delete(oldest);}
      // Concurrent misses may complete for the same key.
      if(cache.has(cacheKey))used-=cache.get(cacheKey).bytes.length;
      cache.set(cacheKey,{...result,until:now()+ttl});used+=result.bytes.length;
    }
    return result;
  };
}
