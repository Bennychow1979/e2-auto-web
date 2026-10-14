import {validVehicleId} from '../vehicle-seo.mjs';
// Public relation metadata only. No Drive file IDs, private metadata or bytes.
export async function fetchPublicPhotoCoverage(config,snapshot,request=fetch){
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(config?.supabaseUrl||'')||!/^sb_publishable_[A-Za-z0-9_-]+$/.test(config?.publishableKey||''))throw Error('Anonymous inventory connection required.');
 const expected=new Map(snapshot.vehicles.map(row=>[row.id,row])),seen=new Set(),coverage=[];
 for(let offset=0;offset<expected.size;offset+=200){
  const url=new URL(config.supabaseUrl+'/rest/v1/vehicles');url.search=new URLSearchParams({select:'id,publication,updated_at,vehicle_photos(id,source,position)',publication:'eq.published',order:'id.asc',limit:'200',offset:String(offset),'vehicle_photos.order':'position.asc,id.asc','vehicle_photos.limit':'1'});
  const response=await request(url,{headers:{apikey:config.publishableKey,Prefer:'count=exact'},credentials:'omit',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error('Public photo coverage is unavailable.');
  const count=Number(/\/(\d+)$/.exec(response.headers.get('content-range')||'')?.[1]),rows=await response.json();
  if(count!==expected.size||!Array.isArray(rows)||rows.length!==Math.min(200,expected.size-offset))throw Error('Public inventory changed before photo coverage completed.');
  for(const row of rows){
   if(!expected.has(row.id)||seen.has(row.id)||row.publication!=='published'||row.updated_at!==expected.get(row.id).updated_at||!Array.isArray(row.vehicle_photos)||row.vehicle_photos.length>1)throw Error('Public photo coverage does not match the inventory snapshot.');seen.add(row.id);
   const photo=row.vehicle_photos[0];if(photo&&(!validVehicleId(photo.id)||!['drive','upload'].includes(photo.source)||!Number.isInteger(photo.position)))throw Error('Invalid public photo identity.');
   coverage.push({vehicleId:row.id,photoId:photo?.id||null,source:photo?.source||null});
  }
 }
 if(seen.size!==expected.size)throw Error('Incomplete photo coverage.');return coverage;
}
