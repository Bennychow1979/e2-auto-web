const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function publicVehicleImageURL(origin,id){
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(origin||'')||!idPattern.test(id||''))throw Error('Invalid public vehicle image identity.');
 return origin+'/functions/v1/e2-drive-photos?public_vehicle='+id.toLowerCase();
}
export async function probePublicImageGateway(origin,id,request=fetch){
 const response=await request(publicVehicleImageURL(origin,id),{method:'HEAD',credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
 return response.ok&&response.headers.get('x-e2-public-image')==='v2'&&/^image\/(jpeg|png|webp)$/.test(response.headers.get('content-type')||'')&&response.headers.get('cache-control')==='no-store'&&response.headers.get('x-content-type-options')==='nosniff'&&response.headers.get('referrer-policy')==='no-referrer'&&response.headers.get('content-disposition')==='inline';
}
