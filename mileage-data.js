import {db,check} from './mileage-session.mjs?v=ui-1';
export const historyColumns='id,record_sequence,vehicle_id,plate_snapshot,actor,actor_name,inspected_at,created_at,reading,unit,normalized_km,photo_path,note,result,reasons,previous_mileage,next_mileage';
export function createMileageAPI(client=db){
 if(!client)return null;
 return {
  async identity(){const user=check(await client.auth.getUser())?.user;if(!user?.id)return null;const membership=check(await client.from('staff_memberships').select('user_id,role,active').eq('user_id',user.id).maybeSingle());return membership?.user_id===user.id&&membership.active===true&&['sales','admin','super_admin'].includes(membership.role)?{id:user.id,role:membership.role,active:true}:null;},
  onAuth(callback){return client.auth.onAuthStateChange(callback).data.subscription;},
  async vehicles(){const rows=[];for(let offset=0;;offset+=100){const batch=check(await client.from('vehicles').select('id,plate,brand,model,year,publication,stock_status').order('plate').order('id').range(offset,offset+99));rows.push(...batch);if(batch.length<100)return rows;}},
  async context(target){return check(await client.rpc('e2_mileage_context',{target}));},
  async history(target,before){let query=client.from('vehicle_mileage_checks').select(historyColumns).eq('vehicle_id',target).order('record_sequence',{ascending:false}).limit(25);if(before)query=query.lt('record_sequence',before);return check(await query);},
  async prepare(target,version,photo){return check(await client.rpc('e2_begin_mileage_upload',{target,expected_version:version,client_upload_id:photo.clientId,file_mime:photo.file.type,file_bytes:photo.file.size}));},
  async upload(path,file){return check(await client.storage.from('e2-mileage-evidence').upload(path,file,{upsert:false,contentType:file.type,cacheControl:'0'}));},
  async verify(upload){const response=await client.functions.invoke('e2-mileage-evidence',{body:{upload}});if(response.error){let details;try{details=await response.error.context?.json()}catch{}throw Error(details?.error||response.error.message||'照片校验失败，请重试。');}if(!response.data?.ready||response.data.id!==upload)throw Error('照片校验未完成，请重试。');return response.data;},
  async submit(request){const data=check(await client.rpc('e2_submit_mileage_check',request));const result=Array.isArray(data)?(data.length===1?data[0]:null):data;if(!result?.id||!['applied','recorded_only'].includes(result.result))throw Error('Submission receipt is unavailable. Retry the same submission.');return result;},
  async photo(path){return check(await client.storage.from('e2-mileage-evidence').download(path));}
 };
}
export const mileageAPI=createMileageAPI();
