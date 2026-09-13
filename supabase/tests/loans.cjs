const {PGlite}=require('@electric-sql/pglite');const fs=require('node:fs');const assert=require('node:assert/strict');
(async()=>{const db=new PGlite();let passed=0;
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));
alter table storage.objects enable row level security;grant usage on schema public,auth,storage to anon,authenticated,service_role;
grant select,insert,update,delete on storage.objects to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
for(const f of ['202609120001_inventory.sql','202609130002_photo_order.sql','202609130003_photo_limit_30.sql','202609130004_super_admin.sql','202609130005_staff_profiles.sql','202609130006_customers.sql','202609140006_saved_vehicles.sql','202609140007_customer_workspace.sql','202609140008_loan_validation.sql','202609140009_loan_workflow.sql']){if(f==='202609140007_customer_workspace.sql')await db.exec('alter default privileges in schema public grant execute on functions to anon,authenticated');await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));}
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
let a;
const save=(details,step=0,rev=a.revision)=>call('select * from public.e2_save_loan($1,$2,$3,$4)',[a.id,JSON.stringify(details),step,rev]);
const submit=(confirmDetails=true,confirmContacts=true)=>call('select * from public.e2_submit_loan($1,$2,$3,$4)',[a.id,a.revision,confirmDetails,confirmContacts]);
const status=(next,note='Test follow-up')=>call('select * from public.e2_update_loan_status($1,$2,$3,$4)',[a.id,next,note,a.revision]);
const assign=(staff,rev=a.revision)=>call('select * from public.e2_assign_loan($1,$2,$3)',[a.id,staff,rev]);
const denied=async(fn,label)=>{await assert.rejects(fn);passed++;console.log('PASS '+label)};
const check=(actual,expected,label)=>{assert.deepEqual(actual,expected);passed++;console.log('PASS '+label)};
await as(null);await denied(()=>start(cars[0]),'Anonymous cannot create draft');await no('select * from public.loan_applications','Anonymous cannot read loans');
for(const id of [unconfirmed,inactive]){await as(id);await denied(()=>start(cars[0]),'Unconfirmed/inactive cannot create loan')}
await as(customer);await denied(()=>start(cars[0],null,false),'Privacy acceptance required');await denied(()=>start(cars[11]),'Unpublished vehicle rejected');await denied(()=>start(cars[0],account),'Non-public or ineligible staff rejected');
a=await start(cars[0]);check(a.customer_id,customer,'Draft owner derived from auth');check(a.vehicle_summary.price,50000,'Price snapshot derived from inventory');check((await start(cars[0])).id,a.id,'Duplicate start resumes same application');
for(const id of [owner,admin,sales,account,other]){await as(id);await yes('select count(*)::integer value from public.loan_applications',0,'Draft hidden from other customer and every staff role');await denied(()=>save({}), 'Others cannot edit applicant details')}
await as(customer);await no("update public.loan_applications set details='{}'",'No direct loan writes');await no('delete from public.loan_applications','No direct deletion');await no("insert into public.loan_events(application_id,event) values('"+a.id+"','Forged')",'No direct event writes');
a=await save({email:'partial@',phone:'6'},2);check(a.last_step,2,'Partial email and phone saved at selected step');
await denied(()=>save({},1,1),'Stale revision rejected');await denied(()=>save({},7),'Out-of-range step rejected');await denied(()=>save({role:'super_admin'}),'Unknown data field rejected');await denied(()=>save({name:123}),'Non-string field rejected');await denied(()=>save({name:'a'.repeat(151)}),'Oversized field rejected');await denied(()=>save({tenure:'20 years'}),'Invalid option rejected');await denied(()=>save({deposit:'50001'}),'Deposit above price rejected');await denied(()=>save({deposit:'-1'}),'Negative deposit rejected');await denied(()=>submit(),'Missing required sections cannot submit');
const {sections}=await import('../../loan-fields.js');
function details(guarantor='Not requested'){
 const d={};for(const [key,,sub,type,required] of sections({guarantor}).flat()){
  if(!required)continue;
  d[key]=Array.isArray(type)?type[0]:type==='email'?'test@example.test':type==='tel'?'60123456789':type==='year'?'2020':type==='number'?'2':'Test information';
 }
 d.guarantor=guarantor;d.deposit='5000';return d;
}
const complete=details();a=await save({...complete,g_name:'Ignored hidden guarantor',debt:'100'},6);check('g_name' in a.details,false,'Hidden guarantor details removed');check('debt' in a.details,false,'Inactive debt details removed');
await denied(()=>submit(false,true),'Accuracy confirmation required');await denied(()=>submit(true,false),'Third-party permission confirmation required');
a=await save({...complete,email:'bad'},6);await denied(()=>submit(),'Malformed email rejected on submission');
a=await save({...complete,phone:'123'},6);await denied(()=>submit(),'Malformed phone rejected on submission');
a=await save({...complete,guarantor:'Yes'},6);await denied(()=>submit(),'Guarantor Yes requires guarantor details');
a=await save(complete,6);const before=a.revision;a=await submit();check(a.status,'Submitted to E2','Complete application submitted');check(a.revision,Number(before)+1,'Submission advances revision');check(Boolean(a.submitted_at&&a.confirmed_at),true,'Submission and confirmation timestamp recorded');await denied(()=>save(complete),'Submitted customer edit locked');await denied(()=>submit(),'Double submission blocked');
for(const id of [owner,sales]){await as(id);await yes('select count(*)::integer value from public.loan_applications',1,'Super and assigned salesperson read submitted application')}
for(const id of [admin,account,other]){await as(id);await yes('select count(*)::integer value from public.loan_applications',0,'Unassigned Admin, Account and unrelated customer blocked');await yes('select count(*)::integer value from public.loan_events',0,'Events cannot leak inaccessible application');await denied(()=>status('Needs information'),'Unauthorized follow-up rejected')}
await as(sales);await denied(()=>status('Outcome recorded'),'Cannot skip workflow');await denied(()=>status('Needs information',''),'Customer-facing explanation required');await denied(()=>assign(admin),'Only Super can reassign');
a=await status('Needs information','Please check your address.');await as(customer);check((await call('select status from public.loan_applications where id=$1',[a.id])).status,'Needs information','Customer sees request');a=await save({...complete,address:'Corrected address'},2);a=await submit();check(a.status,'Submitted to E2','Customer corrects and resubmits');
await as(owner);await denied(()=>assign(account),'Ineligible assignment rejected');await denied(()=>assign(admin,1),'Stale assignment rejected');a=await assign(admin);await as(sales);await yes('select count(*)::integer value from public.loan_applications',0,'Former assignee loses access');await as(admin);await yes('select count(*)::integer value from public.loan_applications',1,'New assignee gains submitted access');
a=await status('Ready for financier');a=await status('Submitted to financier');a=await status('Outcome recorded','Actual outcome recorded by E2.');check(a.status,'Outcome recorded','Manual progress transitions succeed');await denied(()=>status('Ready for financier'),'Terminal outcome is read-only');
await as(customer);await yes('select count(*)::integer value from public.loan_events',7,'Customer sees complete progress history');
a=await start(cars[1],null);a=await save(details('Yes'),6);a=await submit();check(a.details.g_name,'Test information','Complete guarantor application can submit');
await as(admin);await yes('select count(*)::integer value from public.loan_applications',1,'Unassigned second loan not visible to Admin');
await as(customer);a=await start(cars[2]);a=await save(complete,6);
await db.exec('reset role');await db.query("update public.vehicles set publication='draft' where id=$1",[cars[2]]);await as(customer);await denied(()=>submit(),'Availability rechecked at submission');
for(let i=3;i<=10;i++)await start(cars[i]);await denied(()=>start(cars[0]),'Ten active applications maximum');
await db.exec('reset role');await db.query("insert into public.staff_memberships(user_id,role,active) values($1,'customer',false)",[customer]);await as(customer);await yes('select count(*)::integer value from public.loan_applications',0,'Deactivated customer cannot read applications');await denied(()=>save(complete),'Deactivated customer cannot save');
await db.close();console.log(passed+' loan privacy and workflow checks passed.');
})().catch(e=>{console.error(e);process.exit(1)});
