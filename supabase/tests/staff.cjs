const {PGlite}=require('@electric-sql/pglite');const fs=require('node:fs');const assert=require('node:assert/strict');
(async()=>{
const db=new PGlite();let passed=0;
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));
alter table storage.objects enable row level security;grant usage on schema public,auth,storage to anon,authenticated,service_role;
grant select,insert,update,delete on storage.objects to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
for(const file of ['202609120001_inventory.sql','202609130002_photo_order.sql','202609130003_photo_limit_30.sql','202609130004_super_admin.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
const owner='00000000-0000-4000-8000-000000000001',admin='00000000-0000-4000-8000-000000000002',sales='00000000-0000-4000-8000-000000000003',invite='00000000-0000-4000-8000-000000000004',account='00000000-0000-4000-8000-000000000005',customer='00000000-0000-4000-8000-000000000006';
for(const [i,id] of [owner,admin,sales,invite,account,customer].entries())await db.query('insert into auth.users values($1,$2,now())',[id,'user'+i+'@example.com']);
await db.exec(`insert into public.staff_memberships(user_id,role) values('${owner}','super_admin'),('${admin}','admin'),('${sales}','sales'),('${account}','account'),('${customer}','customer')`);
async function as(id){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec('set role '+(id?'authenticated':'anon'))}
async function fails(sql,pattern,label){await assert.rejects(db.exec(sql),pattern);passed++;console.log('PASS '+label)}
async function ok(sql,expected,label){assert.equal((await db.query(sql)).rows[0].value,expected);passed++;console.log('PASS '+label)}
const update=(id,role,active,rev)=>`select public.e2_update_staff('${id}','${role}',${active},${rev})`;
for(const id of [null,admin,sales,account,customer]){await as(id);await fails('select * from public.e2_list_staff()',/permission denied|Super Admin/,'Non-super role cannot list staff emails');await fails(update(owner,'admin',false,1),/permission denied|Super Admin/,'Non-super role cannot change permissions');await fails("select public.e2_add_staff_by_email('user3@example.com','super_admin')",/permission denied|Super Admin/,'Non-super role cannot add a privileged user');await fails('select public.e2_check_invite()',/permission denied|Super Admin/,'Non-super role cannot authorize invitations')}
await as(owner);await ok('select count(*)::integer value from public.e2_list_staff()',5,'Super Admin lists staff');
await ok('select public.e2_is_admin() value',true,'Super Admin retains vehicle management');
await ok('select public.e2_can_read_stock() value',true,'Super Admin retains private inventory');
await fails(update(owner,'admin',true,1),/at least one/,'Cannot remove last Super Admin');
await fails(update(owner,'super_admin',false,1),/at least one/,'Cannot disable last Super Admin');
await fails(update(owner,'super_admin',true,1),/own access/,'Own permissions are protected');
await fails(update(admin,'root',true,1),/valid role/,'Unknown role rejected');
await fails(update(admin,'sales',true,99),/another session/,'Stale permission changes rejected');
await db.exec(update(admin,'sales',false,1));
await ok(`select revision::integer value from public.e2_list_staff() where user_id='${admin}'`,2,'Permission revision increments');
await as(admin);await ok('select public.e2_is_admin() value',false,'Demoted disabled Admin loses writes immediately');
await ok('select public.e2_can_read_stock() value',false,'Inactive account loses private stock access');
await ok('select count(*)::integer value from public.staff_access_audit',0,'Admin cannot read user-management audit');
await as(owner);await db.exec("select public.e2_add_staff_by_email(' USER3@EXAMPLE.COM ','sales')");
await ok(`select count(*)::integer value from public.e2_list_staff() where user_id='${invite}' and role='sales'`,1,'Existing invited Auth account can receive a role');
await fails("select public.e2_add_staff_by_email('user3@example.com','super_admin')",/already listed/,'Add cannot silently promote existing user');
await fails("select public.e2_add_staff_by_email('missing@example.com','admin')",/first/,'Cannot attach missing Auth account');
await db.exec(update(invite,'super_admin',true,1));
await as(invite);await db.exec(update(owner,'admin',true,1));
await as(owner);await fails('select * from public.e2_list_staff()',/Super Admin/,'Demoted Super Admin immediately loses user management');
await as(invite);await fails(update(invite,'sales',true,2),/at least one/,'Last-admin check still holds after transfer');
for(let i=0;i<20;i++)await db.exec('select public.e2_check_invite()');
await fails('select public.e2_check_invite()',/Invitation limit/,'Invitation attempts are rate limited');
await ok("select count(*)::integer value from public.staff_access_audit where action='UPDATE_ACCESS'",3,'Access changes are audited');
await as(customer);await fails(`update public.staff_memberships set role='super_admin' where user_id='${customer}'`,/permission denied/,'Direct self-promotion denied');
await db.close();console.log(passed+' staff permission checks passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
