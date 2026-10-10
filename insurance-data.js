import {db,check} from './e2-data.js';
export {db};
const rpc=(name,args)=>db.rpc(name,args).then(check);
export const who=async()=>{const user=check(await db.auth.getUser()).user;if(!user)throw Error('Sign in with your staff account.');return user;};
export const load=target=>rpc('e2_policy_workspace',{target});
export const reserve=(c,file,analysis)=>rpc('e2_reserve_policy',{target:c.id,expected_case_revision:c.revision,file_name:file.name,file_mime:analysis.mime,file_bytes:file.size,file_sha256:analysis.sha256});
export async function upload(document,file){
  const storage=db.storage.from('insurance-policies');
  const result=await storage.upload(document.path,file,{contentType:document.mime_type,upsert:false});
  if(!result.error)return;
  if(String(result.error.statusCode)!=='409'&&result.error.error!=='Duplicate')throw result.error;
  // An interrupted upload may have stored the original. Never overwrite it;
  // verify the existing bytes before retrying completion.
  const original=check(await storage.download(document.path));
  if(original.size!==document.byte_size)throw Error('Existing upload differs. Ask for a reviewed cleanup.');
  const digest=await crypto.subtle.digest('SHA-256',await original.arrayBuffer());
  const hash=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
  if(hash!==document.client_sha256)throw Error('Existing upload differs. Ask for a reviewed cleanup.');
}
export const finish=(c,document,extraction)=>rpc('e2_finish_policy',{target:c.id,document_id:document.id,expected_case_revision:c.revision,extraction});
export const save=(workspace,document,params)=>rpc('e2_save_policy_review',{target:workspace.case.id,document_id:document.id,expected_case_revision:workspace.case.revision,expected_revision:workspace.record?.revision||0,...params});
export const download=path=>db.storage.from('insurance-policies').download(path).then(check);
export const signOut=()=>db.auth.signOut({scope:'local'}).then(check);
