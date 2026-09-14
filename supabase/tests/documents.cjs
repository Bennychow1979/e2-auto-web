const {PGlite}=require('@electric-sql/pglite');const fs=require('node:fs');const assert=require('node:assert/strict');
(async()=>{const db=new PGlite();let passed=0;
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
alter table storage.objects enable row level security;grant usage on schema public,auth,storage to anon,authenticated,service_role;
grant select,insert,update,delete on storage.objects to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
for(const f of ['202609120001_inventory.sql','202609130002_photo_order.sql','202609130003_photo_limit_30.sql','202609130004_super_admin.sql','202609130005_staff_profiles.sql','202609130006_customers.sql','202609140006_saved_vehicles.sql','202609140007_customer_workspace.sql','202609140008_loan_validation.sql','202609140009_loan_workflow.sql','202609140010_loan_documents.sql']){if(f==='202609140007_customer_workspace.sql')await db.exec('alter default privileges in schema public grant execute on functions to anon,authenticated');await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));}
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
let a={id:'00000000-0000-4000-8000-000000000099'};
const current=()=>call('select * from public.loan_applications where id=$1',[a.id]);
const type=(kind,rev=a.revision)=>call('select * from public.e2_set_applicant_type($1,$2,$3)',[a.id,kind,rev]);
const reserve=(category='ic_front',months=[],opts={})=>call('select * from public.e2_reserve_document($1,$2,$3,$4,$5,$6,$7)',[a.id,category,opts.name??'Synthetic.pdf',opts.mime??'application/pdf',opts.size??123,months,opts.consent??true]);
const finish=(d,old=null)=>call('select * from public.e2_finish_document($1,$2)',[d.id,old?.id||null]);
const remove=d=>db.query('select public.e2_remove_document($1)',[d.id]);
const upload=(d,meta={size:123,mimetype:'application/pdf'})=>db.query("insert into storage.objects(bucket_id,name,metadata) values('loan-documents',$1,$2)",[d.path,JSON.stringify(meta)]);
const seen=()=>call('select count(*)::int n from public.loan_documents');
const blobs=()=>call("select count(*)::int n from storage.objects where bucket_id='loan-documents'");
const objectDelete=d=>db.query("delete from storage.objects where bucket_id='loan-documents' and name=$1 returning name",[d.path]);
const stat=async next=>{a=await current();return call('select * from public.e2_update_loan_status($1,$2,$3,$4)',[a.id,next,'Synthetic follow-up',a.revision])};
await as(null);await no('select * from public.loan_documents','Anonymous cannot read metadata');await denied(()=>reserve(),'Anonymous cannot reserve');
await yes("select count(*)::int value from storage.objects where bucket_id='loan-documents'",0,'No anonymous file listing');
await db.exec('reset role');await yes("select public value from storage.buckets where id='loan-documents'",false,'Document bucket is private');
await yes("select has_function_privilege('anon','public.e2_finish_document(uuid,uuid)','execute') value",false,'Finalize does not inherit anonymous execute defaults');
await as(customer);a=await start(cars[0]);await denied(()=>reserve(),'Checklist type required');a=await type('worker');
await denied(()=>type('company'),'Corporate applicant type is not accepted');await denied(()=>type('worker',1),'Stale type save rejected');
await denied(()=>reserve('ic_front',[],{consent:false}),'Document notice acceptance required');
await denied(()=>reserve('company_bank_statement',['2026-09']),'Worker cannot use business checklist');
await denied(()=>reserve('ic_front',[],{size:10485761}),'Over 10MB rejected');await denied(()=>reserve('ic_front',[],{size:0}),'Empty file rejected');
await denied(()=>reserve('ic_front',[],{mime:'text/html'}),'HTML MIME rejected');await denied(()=>reserve('ic_front',[],{name:' '}),'Blank name rejected');
const months=(await db.query("select to_char(current_date,'YYYY-MM') m,to_char(current_date-interval '1 month','YYYY-MM') prev")).rows[0];
await denied(()=>reserve('payslip',[]),'Statement months required');await denied(()=>reserve('payslip',[months.m,months.m]),'Duplicate months rejected');
await denied(()=>reserve('payslip',['2099-01']),'Future statement rejected');await denied(()=>reserve('payslip',['2000-01']),'Very old statement rejected');
await denied(()=>reserve('payslip',['2026-99']),'Invalid month rejected');await denied(()=>reserve('ic_front',[months.m]),'Months rejected for IC');
await no("insert into public.loan_documents(application_id,category) values('"+a.id+"','ic_front')",'No direct metadata insert');
await no("insert into storage.objects(bucket_id,name) values('loan-documents','unreserved/path')",'Unreserved storage path rejected');
let d=await reserve();check(d.state,'uploading','New file is staged');check(d.path,a.id+'/'+d.id,'Path uses opaque application and file IDs');check(d.privacy_version,'2026-09-14-documents','Privacy version recorded');check(Boolean(d.privacy_accepted_at),true,'Privacy acceptance time recorded');
await denied(()=>finish(d),'Finalize requires uploaded object');
for(const id of [owner,admin,sales,account,other,unconfirmed,inactive]){await as(id);check((await seen()).n,0,'Draft document metadata hidden from every other role');await denied(()=>upload(d),'Others cannot upload to reserved path');await denied(()=>finish(d),'Others cannot finalize');await denied(()=>remove(d),'Others cannot remove')}
await as(customer);await upload(d,{size:122,mimetype:'application/pdf'});await denied(()=>finish(d),'Object size mismatch rejected');
check((await objectDelete(d)).rows.length,1,'Owner can clean incomplete object');await upload(d);d=await finish(d);check(d.state,'ready','Matching stored object finalizes');check((await finish(d)).id,d.id,'Finalize retry is idempotent');
check((await objectDelete(d)).rows.length,0,'Ready blob cannot be directly deleted');
check((await db.query("update storage.objects set metadata='{}' where name=$1 returning name",[d.path])).rows.length,0,'Ready blob cannot be overwritten');
await denied(()=>upload(d),'Duplicate path upload rejected');await denied(async()=>type('self_employed',(await current()).revision),'Changing checklist cannot discard files');
const cross=await reserve('ic_back');await upload(cross);await denied(()=>finish(cross,d),'Replacement must use the same category');check((await call('select removed_at from public.loan_documents where id=$1',[d.id])).removed_at,null,'Failed replacement preserves original');await remove(cross);await objectDelete(cross);
const replacement=await reserve();await denied(()=>finish(replacement,d),'Original survives incomplete replacement');check((await call('select removed_at from public.loan_documents where id=$1',[d.id])).removed_at,null,'Original remains available');await upload(replacement);let newDoc=await finish(replacement,d);check(Boolean((await call('select removed_at from public.loan_documents where id=$1',[d.id])).removed_at),true,'Successful replacement hides original atomically');check((await objectDelete(d)).rows.length,1,'Removed original storage can be cleaned');
const monthly=await reserve('payslip',[months.m,months.prev]);await upload(monthly);await finish(monthly);check(monthly.covered_months.length,2,'Combined PDF can cover multiple months');
for(const id of [owner,sales]){await as(id);check((await blobs()).n,0,'Staff cannot fetch draft blobs')}
await as(customer);
const {sections}=await import('../../loan-fields.js');const details={};for(const [key,,sub,t,required] of sections({guarantor:'Not requested'}).flat()){if(required)details[key]=Array.isArray(t)?t[0]:t==='email'?'test@example.test':t==='tel'?'60123456789':t==='year'?'2020':t==='number'?'2':'Test information'}details.guarantor='Not requested';details.deposit='5000';
a=await current();a=await call('select * from public.e2_save_loan($1,$2,6,$3)',[a.id,JSON.stringify(details),a.revision]);a=await call('select * from public.e2_submit_loan($1,$2,true,true)',[a.id,a.revision]);
for(const id of [owner,sales]){await as(id);check((await seen()).n,2,'Super and assignee see ready submitted files only');check((await blobs()).n,2,'Super and assignee can fetch submitted files');await denied(()=>reserve(),'Staff cannot upload');await denied(()=>remove(newDoc),'Staff cannot remove');await denied(()=>type('worker'),'Staff cannot change checklist')}
for(const id of [admin,account,other,unconfirmed,inactive]){await as(id);check((await seen()).n,0,'Unassigned or inactive accounts cannot see submitted documents');check((await blobs()).n,0,'Unassigned or inactive accounts cannot fetch submitted blobs')}
await as(customer);const pending=await reserve('epf');await upload(pending);await as(sales);check((await seen()).n,2,'Submitted pending upload remains hidden from staff');check((await blobs()).n,2,'Pending blob remains hidden from staff');
await as(customer);await finish(pending);await as(sales);check((await blobs()).n,3,'Finalized follow-up file becomes visible');a=await stat('Ready for financier');
await as(customer);await denied(()=>reserve(),'Ready-for-financier uploads locked');await denied(()=>remove(newDoc),'Ready-for-financier removal locked');await denied(async()=>type('worker',(await current()).revision),'Ready-for-financier checklist locked');
await as(sales);a=await stat('Needs information');await as(customer);await remove(newDoc);await as(sales);check((await blobs()).n,2,'Removal revokes staff access before physical cleanup');await as(customer);await objectDelete(newDoc);
await as(owner);a=await current();a=await call('select * from public.e2_assign_loan($1,$2,$3)',[a.id,admin,a.revision]);await as(sales);check((await blobs()).n,0,'Former assignee loses file access');await as(admin);check((await blobs()).n,2,'New assignee gains file access');
await db.exec('reset role');await db.query('update public.staff_memberships set active=false where user_id=$1',[admin]);await as(admin);check((await blobs()).n,0,'Deactivated assignee loses file access');
await as(other);const first=a;a=await start(cars[1]);a=await type('self_employed');await denied(()=>reserve('payslip',[months.m]),'Self-employed cannot upload worker payslips');let business=await reserve('company_bank_statement',[months.m]);await upload(business);business=await finish(business);check((await finish(business,newDoc)).id,business.id,'Finalize retry cannot change another file');
await as(customer);check((await call('select count(*)::int n from public.loan_documents where id=$1',[business.id])).n,0,'Other application file isolated');await denied(()=>remove(business),'Cross-customer removal blocked');
await as(other);for(let i=1;i<30;i++)await reserve('driving_license');await denied(()=>reserve('ic_back'),'Thirty active files enforced server-side');
await db.exec('reset role');await db.query("insert into public.staff_memberships(user_id,role,active) values($1,'customer',false)",[other]);await as(other);check((await blobs()).n,0,'Disabled applicant loses file access');await denied(()=>reserve(),'Disabled applicant upload blocked');
const {fileType,checklist,categoryProgress}=await import('../../document-fields.js');
check(await fileType(new Blob(['%PDF-1.4 test'])),'application/pdf','PDF signature accepted');check(await fileType(new Blob([new Uint8Array([137,80,78,71,13,10,26,10])])),'image/png','PNG signature accepted');await denied(()=>fileType(new Blob(['<html>'],{type:'application/pdf'})),'Disguised HTML rejected by preview/upload');check(checklist('worker').length,6,'Worker checklist has six upload categories');check(checklist('self_employed').length,4,'Self-employed individual checklist has four categories');check(categoryProgress({key:'payslip',months:3},[{category:'payslip',state:'ready',covered_months:['2026-08']},{category:'payslip',state:'ready',covered_months:['2026-08']}]),'1 / 3 months uploaded','Duplicate files do not over-count a month');
await db.close();console.log(passed+' document privacy and upload checks passed.');
})().catch(e=>{console.error(e);process.exit(1)});


