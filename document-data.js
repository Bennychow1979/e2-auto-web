import {customerDB,check} from './customer-data.js?v=customer-1';
import {db as staffDB} from './e2-data.js?v=documents-1';
export {check};
export const staffView=new URLSearchParams(location.search).get('staff')==='1';
export const db=staffView?staffDB:customerDB;
const unwrap=r=>{const value=check(r);return Array.isArray(value)?value[0]:value};
export async function sessionUser(){return check(await db.auth.getUser()).user}
export async function application(id,userId){let q=db.from('loan_applications').select('*').eq('id',id);if(!staffView)q=q.eq('customer_id',userId);return check(await q.single())}
export async function documentRows(id){const rows=[];for(let offset=0;;offset+=100){const batch=check(await db.from('loan_documents').select('*').eq('application_id',id).order('created_at').order('id').range(offset,offset+99));rows.push(...batch);if(batch.length<100)return rows}}
export const setType=(a,kind)=>db.rpc('e2_set_applicant_type',{target:a.id,kind,expected_revision:a.revision}).then(unwrap);
export const reserve=(id,item,file,mime,months)=>db.rpc('e2_reserve_document',{target:id,doc_category:item.key,file_name:file.name,file_mime:mime,file_bytes:file.size,months,accept_notice:true}).then(unwrap);
export const finish=(doc,replaces)=>db.rpc('e2_finish_document',{document_id:doc.id,replaces:replaces||null}).then(unwrap);
export const remove=doc=>db.rpc('e2_remove_document',{document_id:doc.id}).then(check);
export const storage=()=>db.storage.from('loan-documents');
