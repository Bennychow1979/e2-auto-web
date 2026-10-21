import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
export async function operationsDatabase(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
 alter table storage.objects enable row level security;grant usage on schema public,auth,storage to anon,authenticated,service_role;
 grant select,insert,update,delete on storage.objects to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
 alter default privileges in schema public grant execute on functions to anon,authenticated;`);
 for(const file of readdirSync('supabase/migrations').filter(f=>f<'202609180001'))await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
 for(const file of ['202609220001_partner_referrals.sql','202610010002_viewing_bookings.sql','202610200006_viewing_rotation_notifications.sql','202610200007_viewing_notification_dispatch.sql','202610200008_vehicle_inspections.sql','202610210001_inspection_defect_photos.sql','202610210002_inspection_workshops.sql','202610210003_runner_bills.sql'])await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
 const ids=Object.fromEntries(['admin','runner','runner2','inspector','account','sales','inactive','car','car2','inspection'].map(k=>[k,randomUUID()]));
 for(const name of ['admin','runner','runner2','inspector','account','sales','inactive']){
  const role={admin:'super_admin',runner2:'runner',inactive:'runner'}[name]||name;
  await db.query('insert into auth.users values($1,$2,now())',[ids[name],name+'@example.test']);
  await db.query('insert into public.staff_memberships(user_id,role,active) values($1,$2,$3)',[ids[name],role,name!=='inactive']);
  await db.query('insert into public.staff_profiles(user_id,display_name) values($1,$2)',[ids[name],'DEMO '+name]);
 }
 for(const [key,plate] of [['car','DEMO01'],['car2','DEMO02']])await db.query("insert into public.vehicles(id,plate,brand,model,variant,year,engine_litres,transmission,fuel_type,price) values($1,$2,'Demo','Vehicle','Test only',2020,1.5,'Auto','PETROL',50000)",[ids[key],plate]);
 await db.query("insert into public.e2_vehicle_inspections(id,vehicle_id,assigned_to,created_by,workshop) values($1,$2,$3,$3,'DEMO Workshop')",[ids.inspection,ids.car,ids.inspector]);
 async function as(name){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[name]||'']);await db.exec('set role '+(ids[name]?'authenticated':'anon'));}
 async function scalar(sql,args=[]){return Object.values((await db.query(sql,args)).rows[0])[0];}
 const procedures={
  e2_operations_workspace:[],
  e2_save_runner_job:['request_id','expected_revision','details'],
  e2_accept_runner_job:['target','expected_revision'],
  e2_move_runner_job:['target','expected_revision','next_status','mileage','note'],
  e2_save_ops_claim:['request_id','expected_revision','details'],
  e2_action_ops_claim:['target','expected_revision','action','note','payment_date','payment_reference'],
  e2_reserve_ops_file:['request_id','job_id','claim_id','file_kind','file_name','file_mime','file_bytes'],
  e2_finish_ops_file:['file_id']
 };
 async function rpc(name,args={}){if(!Object.hasOwn(procedures,name))throw Error('Unsupported preview call');const keys=procedures[name];return scalar(`select to_jsonb(public.${name}(${keys.map((k,i)=>`$${i+1}`).join(',')}))`,keys.map(k=>args[k]??null));}
 return {db,ids,as,scalar,rpc};
}
