const {PGlite}=require('@electric-sql/pglite');const fs=require('node:fs');const assert=require('node:assert/strict');
(async()=>{const db=new PGlite();let passed=0;
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
alter table storage.objects enable row level security;grant usage on schema public,auth,storage to anon,authenticated,service_role;
grant select,insert,update,delete on storage.objects to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
for(const f of ['202609120001_inventory.sql','202609130002_photo_order.sql','202609130003_photo_limit_30.sql','202609130004_super_admin.sql','202609130005_staff_profiles.sql','202609130006_customers.sql','202609140006_saved_vehicles.sql','202609140007_customer_workspace.sql','202609140008_loan_validation.sql','202609140009_loan_workflow.sql','202609140010_loan_documents.sql','202609140011_guest_intake.sql']){if(f==='202609140007_customer_workspace.sql')await db.exec('alter default privileges in schema public grant execute on functions to anon,authenticated');await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));}
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

const crypto=require('node:crypto'),nonce=crypto.randomUUID();
const service=async()=>{await db.exec('reset role');await db.exec('set role service_role')};
const scalar=async(sql,args=[])=>Object.values(await call(sql,args))[0];
await as(sales);const link=await call('select * from public.e2_create_intake_link($1)',[cars[0]]);
check(link.salesperson,sales,'Invitation belongs to signed-in salesperson');
check((await call('select * from public.e2_create_intake_link($1)',[cars[0]])).id,link.id,'Repeated create reuses active link');
await rejects('select * from public.e2_create_intake_link($1)',[cars[11]],'Unpublished car cannot be invited');
for(const id of [null,customer,account]){await as(id);await rejects('select * from public.e2_create_intake_link($1)',[cars[0]],'Only eligible staff create invitations')}
for(const role of ['anon','authenticated']){await db.exec('reset role');check(await scalar("select has_function_privilege($1,'public.e2_intake_begin(uuid,uuid,text)','execute')",[role]),false,'Direct guest session RPC blocked for '+role);check(await scalar("select has_function_privilege($1,'public.e2_intake_submit(uuid,uuid,jsonb,boolean,boolean,boolean)','execute')",[role]),false,'Direct submission RPC blocked for '+role)}
await service();const context=await scalar('select public.e2_intake_context($1)',[link.id]);check(Object.keys(context).sort(),['contact','expires_at','vehicle'],'Public context only contains public car and contact');
const begin=()=>scalar('select public.e2_intake_begin($1,$2,$3)',[link.id,nonce,'worker']);const a=await begin();check(a.received,false,'New session not submitted');check((await begin()).id,a.id,'Begin retry idempotent');
const fileID=crypto.randomUUID();const reserve=(category='ic_front',months=[],file=fileID,mime='application/pdf',size=123)=>call('select * from public.e2_intake_prepare_file($1,$2,$3,$4,$5,$6,$7,$8)',[a.id,nonce,file,category,'Synthetic.pdf',mime,size,months]);
await denied(()=>reserve('company_bank_statement',['2026-09']),'Wrong checklist blocked');await denied(()=>reserve('payslip',[]),'Monthly file requires covered months');await denied(()=>reserve('ic_front',['2026-09']),'IC cannot claim statement months');await denied(()=>reserve('ic_front',[],fileID,'text/html'),'Unsafe MIME rejected');await denied(()=>reserve('ic_front',[],fileID,'application/pdf',10485761),'Oversize file blocked');
let f=await reserve();check((await reserve()).id,f.id,'Upload reservation idempotent');await denied(()=>reserve('ic_back'),'File ID cannot replace another category');
const finish=()=>scalar('select public.e2_intake_finish_file($1,$2,$3)',[a.id,nonce,fileID]);await denied(()=>finish(),'Object required before finalization');
await db.exec('reset role');await db.query("insert into storage.objects(bucket_id,name,metadata) values('intake-documents',$1,$2)",[f.path,JSON.stringify({size:123,mimetype:'application/pdf'})]);await service();check(await finish(),true,'Matching upload becomes ready');
await rejects('select public.e2_intake_session($1,$2)',[a.id,crypto.randomUUID()],'Wrong write secret cannot access session');
for(const id of [owner,sales,admin,account,customer,other]){await as(id);check(await scalar('select count(*)::int from public.intake_submissions'),0,'Unsubmitted application hidden');check(await scalar("select count(*)::int from storage.objects where bucket_id='intake-documents'"),0,'Unsubmitted files hidden')}
const {sections}=await import('../../intake-fields.js');const details={};for(const [key,,sub,t,required] of sections({guarantor:'Not requested'}).flat()){if(required)details[key]=Array.isArray(t)?t[0]:t==='email'?'test@example.test':t==='tel'?'60123456789':t==='year'?'2020':t==='number'?'2':'Synthetic information'}details.guarantor='Not requested';details.deposit='5000';delete details.email;
await service();const submit=(d=details,c=true)=>scalar('select public.e2_intake_submit($1,$2,$3,$4,true,true)',[a.id,nonce,JSON.stringify(d),c]);await denied(()=>submit(details,false),'Privacy consent required');await denied(()=>submit({}),'Complete required fields enforced');await denied(()=>submit({...details,admin:true}),'Unknown field rejected');await denied(()=>submit({...details,email:'bad'}),'Optional email validated when supplied');check((await submit()).received,true,'Complete guest application without email accepted');check(Object.keys(await submit()).sort(),['received','reference'],'Retry returns receipt only');check(await scalar('select count(*)::int from public.intake_events'),1,'Retry does not duplicate submission history');
await denied(()=>reserve('ic_back',[],crypto.randomUUID()),'Received files cannot be modified using guest secret');
for(const id of [owner,sales]){await as(id);check(await scalar('select count(*)::int from public.intake_submissions'),1,'Super and assigned salesperson can read received application');check(await scalar("select count(*)::int from storage.objects where bucket_id='intake-documents'"),1,'Authorized staff can read ready file')}
for(const id of [admin,account,customer,other]){await as(id);check(await scalar('select count(*)::int from public.intake_submissions'),0,'Unassigned accounts cannot read received application');check(await scalar("select count(*)::int from storage.objects where bucket_id='intake-documents'"),0,'Unassigned accounts cannot read files')}
await as(null);await no('select * from public.intake_submissions','Anonymous has no table read');check(await scalar("select count(*)::int from storage.objects where bucket_id='intake-documents'"),0,'Invitation does not allow anonymous file access');
await as(sales);await no("update public.intake_submissions set details='{}'",'Staff cannot rewrite submitted answers');
const hand=(office=admin,rev=2,note='Synthetic documents checked')=>db.query('select public.e2_intake_handoff($1,$2,$3,$4)',[a.id,office,note,rev]);await denied(()=>hand(account),'Only Office Admin role can receive');await denied(()=>hand(admin,1),'Stale handover rejected');await denied(()=>hand(admin,2,''),'Handover note required');await hand();
await as(admin);check(await scalar('select count(*)::int from public.intake_submissions'),1,'Selected Office gains access after handover');check(await scalar("select count(*)::int from storage.objects where bucket_id='intake-documents'"),1,'Selected Office gains document access');
const progress=(status,rev)=>db.query('select public.e2_intake_progress($1,$2,$3,$4)',[a.id,status,'Synthetic actual follow-up',rev]);await as(sales);await denied(()=>progress('Submitted to financier',3),'Sales cannot claim financier submission');await as(admin);await progress('Submitted to financier',3);await progress('Outcome recorded',4);check(await scalar('select count(*)::int from public.intake_events'),4,'Submission handover and actual stages audited');
await db.exec('reset role');await db.query('update public.staff_memberships set active=false where user_id=$1',[admin]);await as(admin);check(await scalar('select count(*)::int from public.intake_submissions'),0,'Disabled Office loses access');

await service();const n2=crypto.randomUUID(),b2=await scalar('select public.e2_intake_begin($1,$2,$3)',[link.id,n2,'self_employed']);
const prep2=(fid,cat='ic_front',months=[])=>call('select * from public.e2_intake_prepare_file($1,$2,$3,$4,$5,$6,$7,$8)',[b2.id,n2,fid,cat,'Synthetic.pdf','application/pdf',123,months]);
await denied(()=>prep2(crypto.randomUUID(),'payslip',['2026-09']),'Business owner cannot use worker payslip category');
let removeID=crypto.randomUUID();let rem=await prep2(removeID);
await db.exec('reset role');await db.query("insert into storage.objects(bucket_id,name,metadata) values('intake-documents',$1,$2)",[rem.path,JSON.stringify({size:123,mimetype:'application/pdf'})]);await service();await db.query('select public.e2_intake_finish_file($1,$2,$3)',[b2.id,n2,removeID]);
await db.query('select public.e2_intake_remove_file($1,$2,$3)',[b2.id,n2,removeID]);await rejects('select public.e2_intake_submit($1,$2,$3,true,true,true)',[b2.id,n2,JSON.stringify(details)],'Removal in progress blocks concurrent submit');await rejects('select public.e2_intake_finish_file($1,$2,$3)',[b2.id,n2,removeID],'Finalization cannot reverse pending deletion');await denied(()=>prep2(removeID),'Reservation retry cannot reverse deletion');
await db.query('select public.e2_intake_forget_file($1,$2,$3)',[b2.id,n2,removeID]);check(await scalar('select count(*)::int from public.intake_files where id=$1',[removeID]),1,'Metadata retained until storage cleanup succeeds');
await db.exec('reset role');await db.query("delete from storage.objects where bucket_id='intake-documents' and name=$1",[rem.path]);await service();await db.query('select public.e2_intake_forget_file($1,$2,$3)',[b2.id,n2,removeID]);check(await scalar('select count(*)::int from public.intake_files where id=$1',[removeID]),0,'Metadata removed after successful object deletion');
for(let i=0;i<30;i++)await prep2(crypto.randomUUID());await denied(()=>prep2(crypto.randomUUID()),'Thirty-file cap enforced');
await db.exec('reset role');await db.query("update public.intake_submissions set expires_at=now()-interval '25 hours' where id=$1",[b2.id]);await service();await rejects('select public.e2_intake_session($1,$2)',[b2.id,n2],'Expired upload secret rejected');check((await db.query('select * from public.e2_intake_expired_files()')).rows.length,30,'Only abandoned expired files eligible for cleanup');
const cleanupID=(await db.query('select * from public.e2_intake_expired_files()')).rows[0].id;await db.query('select public.e2_intake_purge_expired($1)',[cleanupID]);check(await scalar('select count(*)::int from public.intake_files where id=$1',[cleanupID]),0,'Expired object-free reservation purged');await db.query('select public.e2_intake_purge_expired($1)',[fileID]);check(await scalar('select count(*)::int from public.intake_files where id=$1',[fileID]),1,'Received file cannot be purged by abandoned cleanup');
await as(sales);await db.query('select public.e2_revoke_intake_link($1)',[link.id]);await service();await rejects('select public.e2_intake_context($1)',[link.id],'Revoked link stops new intake');await as(sales);check(await scalar('select count(*)::int from public.intake_submissions'),1,'Revoking invite preserves received application');
await db.exec('reset role');check(await scalar("select public from storage.buckets where id='intake-documents'"),false,'Intake bucket private');check(await scalar('select count(*)::int from auth.users'),8,'Guest intake creates no Auth account');

// Optional vehicle intake: exercise the production migration after the original workflow.
await db.exec(fs.readFileSync('supabase/migrations/202609140012_office_admin.sql','utf8'));
await db.exec(fs.readFileSync('supabase/migrations/202609230001_optional_intake_vehicle.sql','utf8'));
await db.query('update public.staff_memberships set active=true where user_id=$1',[admin]);
await as(sales);const undecided=await call('select * from public.e2_create_intake_link(null)');
check(undecided.vehicle_id,null,'Undecided invitation stores no placeholder vehicle');
check((await call('select * from public.e2_create_intake_link(null)')).id,undecided.id,'Undecided invitation reuse is null-safe');
await service();const optionalContext=await scalar('select public.e2_intake_context($1)',[undecided.id]);
check(optionalContext.vehicle.id,null,'Guest context supports undecided vehicle');
check(optionalContext.vehicle.price,null,'Unknown price is not presented as zero');
const optionalNonce=crypto.randomUUID(),optionalApp=await scalar('select public.e2_intake_begin($1,$2,$3)',[undecided.id,optionalNonce,'worker']);
await as(sales);check(await scalar('select count(*)::int from public.intake_submissions where id=$1',[optionalApp.id]),0,'Undecided draft is private');
await service();await rejects('select public.e2_intake_submit($1,$2,$3,false,true,true)',[optionalApp.id,optionalNonce,JSON.stringify(details)],'Undecided enquiry still requires consent');
check((await scalar('select public.e2_intake_submit($1,$2,$3,true,true,true)',[optionalApp.id,optionalNonce,JSON.stringify(details)])).received,true,'Customer submits complete details without a vehicle');
const assign=(vehicle=cars[1],rev=2)=>db.query('select public.e2_intake_assign_vehicle($1,$2,$3)',[optionalApp.id,vehicle,rev]);
for(const id of [null,customer,account,admin,other,inactive]){await as(id);await denied(()=>assign(),'Unauthorized user cannot assign vehicle')}
await as(sales);await rejects('select public.e2_intake_handoff($1,$2,$3,2)',[optionalApp.id,admin,'Checked'],'Handover requires selected vehicle');
await denied(()=>assign(cars[11]),'Unpublished vehicle cannot be assigned');
await denied(()=>assign(null),'Null vehicle cannot be assigned');
await denied(()=>assign(cars[1],1),'Stale assignment is rejected');
await db.exec('reset role');await db.query("update public.vehicles set publication='draft' where id=$1",[cars[2]]);await db.query("update public.vehicles set stock_status='Sold' where id=$1",[cars[2]]);await as(sales);
await denied(()=>assign(cars[2]),'Sold vehicle cannot be assigned');
const before=await scalar('select details from public.intake_submissions where id=$1',[optionalApp.id]);
await assign();
check(await scalar('select vehicle_id from public.intake_submissions where id=$1',[optionalApp.id]),cars[1],'Assigned salesperson selects vehicle');
check(await scalar('select details from public.intake_submissions where id=$1',[optionalApp.id]),before,'Vehicle selection preserves customer answers');
check(await scalar('select revision::int from public.intake_submissions where id=$1',[optionalApp.id]),3,'Assignment increments revision');
check(await scalar("select count(*)::int from public.intake_events where submission_id=$1 and actor=$2 and event='Vehicle selected'",[optionalApp.id,sales]),1,'Vehicle selection records actor and audit event');
await denied(()=>assign(cars[3],3),'Assignment cannot silently replace a selected vehicle');
await db.query('select public.e2_intake_handoff($1,$2,$3,3)',[optionalApp.id,admin,'Vehicle and preferences confirmed']);
await as(admin);check(await scalar('select vehicle_id from public.intake_submissions where id=$1',[optionalApp.id]),cars[1],'Office receives the selected vehicle');
await service();check((await scalar('select public.e2_intake_context($1)',[undecided.id])).vehicle.id,null,'Shared invite stays undecided for later customers');
await as(sales);await db.query('select public.e2_revoke_intake_link($1)',[undecided.id]);await service();await rejects('select public.e2_intake_context($1)',[undecided.id],'Undecided invitation revocation enforced');
await db.exec('reset role');check(await scalar("select has_function_privilege('anon','public.e2_intake_assign_vehicle(uuid,uuid,bigint)','execute')"),false,'Assignment is not anonymous');

await db.close();console.log(passed+' guest intake privacy and workflow checks passed.');
})().catch(e=>{console.error(e);process.exit(1)});
