const {PGlite}=require('@electric-sql/pglite');const fs=require('node:fs');const assert=require('node:assert/strict');
(async()=>{const db=new PGlite();let passed=0;
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
alter table storage.objects enable row level security;grant usage on schema public,auth,storage to anon,authenticated,service_role;
grant select,insert,update,delete on storage.objects to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
for(const f of ['202609120001_inventory.sql','202609130002_photo_order.sql','202609130003_photo_limit_30.sql','202609130004_super_admin.sql','202609130005_staff_profiles.sql','202609130006_customers.sql','202609140006_saved_vehicles.sql','202609140007_customer_workspace.sql','202609140008_loan_validation.sql','202609140009_loan_workflow.sql','202609140010_loan_documents.sql','202609140011_guest_intake.sql','202609140012_office_admin.sql']){if(f==='202609140007_customer_workspace.sql')await db.exec('alter default privileges in schema public grant execute on functions to anon,authenticated');await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));}
await yes("select has_function_privilege('anon','public.e2_save_loan(uuid,jsonb,integer,bigint)','execute') value",false,'Supabase default grants do not expose loan save to anonymous users');
await yes("select has_function_privilege('authenticated','public.e2_validate_loan_details(jsonb,boolean,numeric)','execute') value",false,'Validator remains internal despite Supabase defaults');
const ids=Array.from({length:8},(_,i)=>'00000000-0000-4000-8000-00000000000'+(i+1));
const [owner,admin,sales,account,customer,other,unconfirmed,inactive]=ids;
for(const [i,id] of ids.entries())await db.query('insert into auth.users values($1,$2,$3)',[id,'customer'+i+'@example.test',i===6?null:new Date().toISOString()]);
for(const [id,role,active] of [[owner,'super_admin',true],[admin,'admin',true],[sales,'sales',true],[account,'account',true],[inactive,'customer',false]])await db.query('insert into public.staff_memberships(user_id,role,active) values($1,$2,$3)',[id,role,active]);
async function as(id){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec('set role '+(id?'authenticated':'anon'))}
async function yes(sql,value,label){assert.equal((await db.query(sql)).rows[0].value,value);passed++;console.log('PASS '+label)}
async function no(sql,label){await assert.rejects(db.exec(sql));passed++;console.log('PASS '+label)}


await db.exec('reset role');
for(const id of [sales,admin])await db.query("insert into public.staff_profiles(user_id,display_name,whatsapp,is_public) values($1,'Test staff','60123456789',true)",[id]);
const cars=[];
for(let i=0;i<12;i++){
 const id=(await db.query("insert into public.vehicles(plate,brand,model,variant,year,engine_litres,transmission,fuel_type,price) values($1,'Test','Car','Auto',2020,1.5,'Auto','PETROL',50000) returning id",['LOAN'+i])).rows[0].id;cars.push(id);
 const photo=require('node:crypto').randomUUID(),path=id+'/'+photo+'.webp';
 await db.query("insert into storage.objects(bucket_id,name) values('vehicle-photos',$1)",[path]);
 await db.query('insert into public.vehicle_photos(id,vehicle_id,path,position) values($1,$2,$3,0)',[photo,id,path]);
 if(i!==11)await db.query("update public.vehicles set publication='published' where id=$1",[id]);
}
const call=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
async function rejects(sql,args,label){await assert.rejects(db.query(sql,args));passed++;console.log('PASS '+label)}
const start=(id,staff=sales,consent=true)=>call('select * from public.e2_start_loan($1,$2,$3)',[id,staff,consent]);

const denied=async(fn,label)=>{await assert.rejects(fn);passed++;console.log('PASS '+label)};
const check=(a,b,label)=>{assert.deepEqual(a,b);passed++;console.log('PASS '+label)};


const scalar=async(sql,args=[])=>Object.values(await call(sql,args))[0];
await as(owner);await db.query("select public.e2_update_staff($1,'office_admin',true,1)",[admin]);
await as(admin);check(await scalar('select public.e2_is_admin()'),false,'Office has no inventory edit privileges');check(await scalar('select public.e2_can_read_stock()'),false,'Office cannot read draft inventory');check(await scalar('select public.e2_is_super_admin()'),false,'Office has no Super Admin powers');await no('select * from public.e2_list_staff()','Office cannot list user administration');await rejects('select * from public.e2_create_intake_link($1)',[cars[0]],'Office cannot generate salesperson invitations');
check(await scalar("select count(*)::int from public.vehicles where publication='draft'"),0,'Office cannot query draft vehicles');
await as(sales);const l=await call('select * from public.e2_create_intake_link($1)',[cars[0]]);check((await db.query('select * from public.e2_intake_office_choices()')).rows.some(x=>x.user_id===admin),true,'Office role appears in handover choices');
await db.exec('reset role');const id=require('node:crypto').randomUUID(),fid=require('node:crypto').randomUUID();await db.query("insert into public.intake_submissions(id,link_id,write_hash,vehicle_id,salesperson,vehicle_summary,applicant_type,details,status,submitted_at) values($1,$2,'abc'::bytea,$3,$4,'{}','worker','{}','Received by Salesman',now())",[id,l.id,cars[0],sales]);
await db.query("insert into public.intake_files(id,submission_id,category,filename,mime_type,byte_size,path,state) values($1,$2,'ic_front','Synthetic.pdf','application/pdf',123,$3,'ready')",[fid,id,id+'/'+fid]);await db.query("insert into storage.objects(bucket_id,name) values('intake-documents',$1)",[id+'/'+fid]);
await as(admin);check(await scalar('select count(*)::int from public.intake_submissions'),0,'Office sees no unassigned enquiries');check(await scalar("select count(*)::int from storage.objects where bucket_id='intake-documents'"),0,'Office cannot download before handover');
await as(sales);await db.query('select public.e2_intake_handoff($1,$2,$3,1)',[id,admin,'Synthetic handover']);await as(admin);check(await scalar('select count(*)::int from public.intake_submissions'),1,'Office sees assigned enquiry');check(await scalar("select count(*)::int from storage.objects where bucket_id='intake-documents'"),1,'Office can fetch assigned document');await no("update public.intake_submissions set details='{}'",'Office cannot edit customer answers');await rejects('select public.e2_intake_handoff($1,$2,$3,2)',[id,owner,'Attempted reassign'],'Office cannot hand an enquiry to another user');await db.query("select public.e2_intake_progress($1,'Submitted to financier','Actual recorded submission',2)",[id]);check(await scalar('select status from public.intake_submissions'),'Submitted to financier','Office records actual processing progress');
await db.exec('reset role');const loan=require('node:crypto').randomUUID();await db.query("insert into public.loan_applications(id,customer_id,vehicle_id,vehicle_summary,privacy_accepted_at,status,submitted_at) values($1,$2,$3,'{}',now(),'Submitted to E2',now())",[loan,customer,cars[0]]);
await as(admin);check(await scalar('select count(*)::int from public.loan_applications'),0,'Registered application initially hidden');await as(owner);await db.query('select public.e2_assign_loan($1,$2,1)',[loan,admin]);await as(admin);check(await scalar('select count(*)::int from public.loan_applications'),1,'Office can see specifically assigned registered application');await db.query("select public.e2_update_loan_status($1,'Ready for financier','Documents checked',2)",[loan]);check(await scalar('select status from public.loan_applications'),'Ready for financier','Office can follow up assigned registered application');await rejects('select public.e2_assign_loan($1,$2,3)',[loan,sales],'Office cannot reassign registered loans');
await as(owner);await db.query("select public.e2_update_staff($1,'office_admin',false,2)",[admin]);await as(admin);check(await scalar('select count(*)::int from public.intake_submissions'),0,'Deactivation revokes guest enquiry access');check(await scalar('select count(*)::int from public.loan_applications'),0,'Deactivation revokes registered application access');check(await scalar("select count(*)::int from storage.objects where bucket_id='intake-documents'"),0,'Deactivation revokes file access');
await as(owner);const added=await scalar("select public.e2_add_staff_by_email('customer5@example.test','office_admin')");check(added,other,'Super Admin can attach an existing Auth account as Office');
await db.exec('reset role');check(await scalar("select has_function_privilege('anon','public.e2_update_staff(uuid,text,boolean,bigint)','execute')"),false,'Role update is not anonymous');
await db.close();console.log(passed+' Office Admin permission checks passed.');
})().catch(e=>{console.error(e);process.exit(1)});
