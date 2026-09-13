import {customerDB as db,check} from './customer-data.js?v=customer-1';
export {db,check};
export async function customer(){if(!db)throw Error('The account connection is unavailable. Please try again later.');const session=check(await db.auth.getSession()).session;if(!session)return null;const user=check(await db.auth.getUser()).user;if(!user?.email_confirmed_at||!check(await db.rpc('e2_customer_allowed')))throw Error('Confirm your email and use an active customer account.');return user}
export async function savedRows(){return check(await db.from('saved_vehicles').select('vehicle_id,created_at').order('created_at',{ascending:false}).limit(100))}
export async function setSaved(id,keep){return check(await db.rpc('e2_save_vehicle',{target:id,keep}))}
