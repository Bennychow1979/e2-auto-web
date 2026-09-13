const {PGlite}=require('@electric-sql/pglite');const fs=require('node:fs');const assert=require('node:assert/strict');
(async()=>{const db=new PGlite();let passed=0;
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));
alter table storage.objects enable row level security;grant usage on schema public,auth,storage to anon,authenticated,service_role;
grant select,insert,update,delete on storage.objects to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
for(const f of ['202609120001_inventory.sql','202609130002_photo_order.sql','202609130003_photo_limit_30.sql','202609130004_super_admin.sql','202609130005_staff_profiles.sql','202609130006_customers.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
const ids=Array.from({length:8},(_,i)=>'00000000-0000-4000-8000-00000000000'+(i+1));
const [owner,admin,sales,account,customer,other,unconfirmed,inactive]=ids;
for(const [i,id] of ids.entries())await db.query('insert into auth.users values($1,$2,$3)',[id,'customer'+i+'@example.test',i===6?null:new Date().toISOString()]);
for(const [id,role,active] of [[owner,'super_admin',true],[admin,'admin',true],[sales,'sales',true],[account,'account',true],[inactive,'customer',false]])await db.query('insert into public.staff_memberships(user_id,role,active) values($1,$2,$3)',[id,role,active]);
async function as(id){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec('set role '+(id?'authenticated':'anon'))}
async function yes(sql,value,label){assert.equal((await db.query(sql)).rows[0].value,value);passed++;console.log('PASS '+label)}
async function no(sql,label){await assert.rejects(db.exec(sql));passed++;console.log('PASS '+label)}
const data={full_name:'Test Customer',phone:'60123456789',budget_min:30000,budget_max:80000,desired_car:'Honda CR-V',language:'English'};
const save=(rev,extra={},consent=true)=>"select public.e2_save_customer_profile('"+JSON.stringify({...data,...extra}).replaceAll("'","''")+"'::jsonb,"+rev+","+consent+")";
await as(null);await no(save(0),'Anonymous cannot create a customer profile');await no('select * from public.customer_profiles','Anonymous cannot read customer details');
await as(unconfirmed);await no(save(0),'Unconfirmed email cannot save a profile');
await as(inactive);await no(save(0),'Disabled account cannot create profile');
await as(customer);await no(save(0,{},false),'First save requires privacy acceptance');
await db.exec(save(0,{user_id:owner,role:'super_admin',email:'fake@example.test'}));
await yes('select user_id::text value from public.customer_profiles',customer,'Target is always authenticated customer despite injected user ID');
await yes('select count(*)::integer value from public.staff_memberships',0,'Customer registration never creates a staff membership');
await yes('select public.e2_is_admin() value',false,'Customer cannot become Admin through metadata');
await no("update public.customer_profiles set phone='60999999999'",'Direct write bypass denied');
await no("delete from public.customer_profiles",'Direct delete bypass denied');
await no(save(0),'Stale revision cannot overwrite saved customer profile');
await no(save(1,{phone:'javascript:alert(1)'}),'Invalid phone rejected');
await no(save(1,{budget_min:100000,budget_max:30000}),'Reversed budget rejected');
await no(save(1,{budget_min:-1}),'Negative budget rejected');
await no(save(1,{full_name:' '}),'Blank name rejected');
await no(save(1,{desired_car:'a'.repeat(201)}),'Oversized preference rejected');
await no(save(1,{payment_preference:'APPROVED'}),'Invalid finance preference rejected');
await db.exec(save(1,{budget_min:null,budget_max:null,desired_car:'',privacy_version:'fake',privacy_accepted_at:'2100-01-01'},false));
await yes('select revision::integer value from public.customer_profiles',2,'Profile updates increment revision');
await yes("select privacy_version value from public.customer_profiles",'2026-09-13','Privacy version cannot be overridden');
await yes('select privacy_accepted_at=created_at value from public.customer_profiles',true,'Initial privacy acceptance is retained');
await as(other);await yes('select count(*)::integer value from public.customer_profiles',0,'Customer cannot read another customer');await db.exec(save(0,{full_name:'Second Customer',phone:'6591234567'}));
for(const id of [customer,other,sales,account,inactive,unconfirmed]){await as(id);await no('select * from public.e2_list_customers()','Non-admin cannot list customer emails or preferences')}
await as(sales);await yes('select count(*)::integer value from public.customer_profiles',0,'Sales cannot browse customer profiles');
for(const id of [admin,owner]){await as(id);await yes('select count(*)::integer value from public.e2_list_customers()',2,'Active Admin can list customer directory');await yes("select email value from public.e2_list_customers('Second Customer')",'customer5@example.test','Directory reads verified Auth email rather than client input')}
await as(owner);await no("select * from public.e2_list_customers('',-1)",'Invalid page offset rejected');
await db.exec("select public.e2_update_staff('"+admin+"','admin',false,1)");await as(admin);await no('select * from public.e2_list_customers()','Revoked Admin loses customer access');
await db.exec('reset role');await db.query("insert into public.staff_memberships(user_id,role,active) values($1,'customer',false)",[customer]);
await as(customer);await yes('select count(*)::integer value from public.customer_profiles',0,'Disabled customer loses own profile access');await no(save(2),'Disabled customer cannot update profile');
await db.close();console.log(passed+' customer privacy and authorization checks passed.');
})().catch(e=>{console.error(e);process.exit(1)});
