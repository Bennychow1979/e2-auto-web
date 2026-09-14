
import {db,check,getVehicles} from './e2-data.js?v=guest-1';
export {db,check};
export async function who(){const user=check(await db.auth.getUser()).user;if(!user)throw Error('Staff sign in required.');const membership=check(await db.from('staff_memberships').select('role,active').eq('user_id',user.id).single());if(!membership.active||!['super_admin','admin','office_admin','sales'].includes(membership.role))throw Error('Staff intake access required.');return {...user,role:membership.role}}
export const cars=async()=>(await getVehicles()).filter(v=>v.stock_status==='Available');
export const list=offset=>db.from('intake_submissions').select('id,vehicle_summary,details,status,salesperson,office_admin,submitted_at,revision').order('submitted_at',{ascending:false}).order('id').range(offset,offset+49).then(check);
export const links=()=>db.from('intake_links').select('id,vehicle_id,salesperson,active,expires_at').eq('active',true).order('created_at',{ascending:false}).limit(100).then(check);
export const create=vehicle=>db.rpc('e2_create_intake_link',{vehicle}).then(check).then(v=>Array.isArray(v)?v[0]:v);
export const revoke=target=>db.rpc('e2_revoke_intake_link',{target}).then(check);
export const office=()=>db.rpc('e2_intake_office_choices').then(check);
export const detail=async id=>{const results=await Promise.all([db.from('intake_submissions').select('*').eq('id',id).single().then(check),db.from('intake_files').select('*').eq('submission_id',id).order('created_at').then(check),db.from('intake_events').select('event,note,created_at').eq('submission_id',id).order('id').then(check)]);return {app:results[0],files:results[1],events:results[2]}};
export const handoff=(a,office,message)=>db.rpc('e2_intake_handoff',{target:a.id,office,message,expected_revision:a.revision}).then(check);
export const progress=(a,next_status,message)=>db.rpc('e2_intake_progress',{target:a.id,next_status,message,expected_revision:a.revision}).then(check);
export const download=path=>db.storage.from('intake-documents').download(path).then(check);

export const signOut=()=>db.auth.signOut({scope:'local'}).then(check);
