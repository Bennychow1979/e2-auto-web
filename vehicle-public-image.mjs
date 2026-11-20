const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function publicVehicleImageURL(origin,id,width){
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(origin||'')||!idPattern.test(id||''))throw Error('Invalid public vehicle image identity.');
 if(width!==undefined&&![400,800,1280].includes(width))throw Error('Invalid public image width.');
 return origin+'/functions/v1/e2-drive-photos?public_vehicle='+id.toLowerCase()+(width?'&width='+width:'');
}
export function publicImageSrcset(origin,id){return [400,800,1280].map(width=>publicVehicleImageURL(origin,id,width)+' '+width+'w').join(', ');}
export async function probePublicImageGateway(origin,id,request=fetch){
 const url=publicVehicleImageURL(origin,id);
 // The public endpoint deliberately masks upstream metadata failures as 404.
 // Retry only failed requests, never accept a response with invalid image headers.
 for(let attempt=0;attempt<3;attempt++){
  try{
   const response=await request(url,{method:'HEAD',credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
   if(response.ok)return response.headers.get('x-e2-public-image')==='v2'&&/^image\/(jpeg|png|webp)$/.test(response.headers.get('content-type')||'')&&response.headers.get('cache-control')==='no-store'&&response.headers.get('x-content-type-options')==='nosniff'&&response.headers.get('referrer-policy')==='no-referrer'&&response.headers.get('content-disposition')==='inline';
   if(attempt===2||![404,408,429,500,502,503,504].includes(response.status))return false;
  }catch(error){if(attempt===2)throw error;}
  await new Promise(resolve=>setTimeout(resolve,250*(attempt+1)));
 }
 return false;
}
