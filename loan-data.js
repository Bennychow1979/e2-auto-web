import {customerDB as db,check} from './customer-data.js?v=customer-1';
export {db,check};
export const row=result=>{const data=check(result);return Array.isArray(data)?data[0]:data};
export const editable=a=>['Draft','Needs information'].includes(a.status);
async function owner(){const {user}=check(await db.auth.getUser());if(!user)throw Error('Sign in to continue.');return user.id}
// Customer pages show only the signed-in person's own applications, including when they also have a staff role.
export const getLoan=async id=>check(await db.from('loan_applications').select('*').eq('customer_id',await owner()).eq('id',id).single());
export const getEvents=async id=>{await getLoan(id);return check(await db.from('loan_events').select('event,note,created_at').eq('application_id',id).order('id'))};
export async function getLoans(){const userId=await owner(),all=[];for(let offset=0;;offset+=100){const batch=check(await db.from('loan_applications').select('id,vehicle_id,vehicle_summary,status,last_step,updated_at,revision').eq('customer_id',userId).order('updated_at',{ascending:false}).order('id').range(offset,offset+99));all.push(...batch);if(batch.length<100)return all}}
export const startLoan=async(vehicle,sales)=>row(await db.rpc('e2_start_loan',{vehicle,sales:sales||null,accept_privacy:true}));
export const saveLoan=async(a,details,step)=>row(await db.rpc('e2_save_loan',{target:a.id,details,step,expected_revision:a.revision}));
export const submitLoan=async a=>row(await db.rpc('e2_submit_loan',{target:a.id,expected_revision:a.revision,confirm_details:true,confirm_contacts:true}));
