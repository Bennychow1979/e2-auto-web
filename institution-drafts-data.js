import {db,check} from './e2-data.js';
export async function who(){
 if(!db)throw Error('The database connection is unavailable.');
 const user=check(await db.auth.getUser()).user;
 if(!user)throw Error('Please sign in to E2 Workspace.');
 const member=check(await db.from('staff_memberships').select('role,active').eq('user_id',user.id).single());
 if(!member.active||member.role!=='super_admin')throw Error('Active Super Admin access is required.');
 return user.id;
}
export async function load(){await who();return check(await db.from('e2_finance_institution_drafts').select('name,blacklist_policy,max_loan_years,max_vehicle_age_at_end,portal_url,email_to,required_documents,document_notes,other_documents,checklist_confirmed,active,revision,updated_at').order('name'));}
export async function save(name,revision,payload){await who();return check(await db.rpc('e2_save_institution_draft',{institution_name:name,expected_revision:revision,payload}));}
export function watch(callback){return db?.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT'||event==='USER_UPDATED')callback();});}
