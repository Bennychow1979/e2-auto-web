const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
const db=new PGlite();let passed=0;
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));alter table storage.objects enable row level security;
grant usage on schema public,auth,storage to anon,authenticated,service_role;grant select,insert,update,delete on storage.objects to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
for(const name of ['202609120001_inventory.sql','202609130004_super_admin.sql','202609170013_optional_vehicle_spec.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'));
const ids={admin:'00000000-0000-4000-8000-000000000001',super_admin:'00000000-0000-4000-8000-000000000002',sales:'00000000-0000-4000-8000-000000000003',account:'00000000-0000-4000-8000-000000000004',customer:'00000000-0000-4000-8000-000000000005',inactive:'00000000-0000-4000-8000-000000000006'};
for(const [role,id] of Object.entries(ids))await db.exec(`insert into auth.users(id) values('${id}');insert into staff_memberships(user_id,role,active) values('${id}','${role==='inactive'?'admin':role}',${role!=='inactive'});`);
const car='10000000-0000-4000-8000-000000000001';
async function as(role){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[role]||'']);await db.exec('set role '+(role==='service_role'?'service_role':role==='anon'?'anon':'authenticated'))}
async function fails(sql,label){let error;try{await db.exec(sql)}catch(e){error=e}assert(error,label);passed++}
await as('admin');await db.exec(`insert into vehicles(id,plate,brand,model,variant,year,engine_litres,transmission,fuel_type,price,mileage,mileage_confirmed) values('${car}','TEST','TEST','TEST','',2026,1.5,'Auto','PETROL',100,50000,true)`);
await db.exec('reset role');await db.exec(fs.readFileSync('supabase/migrations/202610190001_vehicle_benefits.sql','utf8'));
const defaults=(await db.query(`select factory_warranty,third_party_warranty,full_service_record from vehicles where id='${car}'`)).rows[0];assert.deepEqual(defaults,{factory_warranty:false,third_party_warranty:'none',full_service_record:false});passed++;
for(const role of ['admin','super_admin']){await as(role);await db.exec(`update vehicles set factory_warranty=true,factory_warranty_expires=current_date+30,factory_warranty_km=100000,third_party_warranty='included',warranty_provider='Test',warranty_package='Test',warranty_months=12,warranty_km=20000,full_service_record=true where id='${car}'`);assert.equal((await db.query(`select full_service_record from vehicles where id='${car}'`)).rows[0].full_service_record,true);await db.exec(`update vehicles set full_service_record=false where id='${car}'`);passed++}
for(const role of ['sales','account','customer','inactive']){await as(role);const result=await db.query(`update vehicles set full_service_record=true where id='${car}' returning id`);assert.equal(result.rows.length,0,role+' denied');passed++}
await as('anon');await fails(`update vehicles set full_service_record=true where id='${car}'`,'anon denied');
await as('service_role');await fails(`update vehicles set full_service_record=true where id='${car}'`,'service import cannot verify labels');
await as('admin');
for(const [set,label] of [["factory_warranty_expires=current_date-1",'expired'],["factory_warranty_km=50000",'at limit'],["factory_warranty_expires=null",'missing date'],["warranty_provider=''",'missing provider'],["third_party_warranty='both'",'exclusive modes'],["warranty_months=0",'invalid term'],["warranty_price=-1",'invalid price']])await fails(`update vehicles set ${set} where id='${car}'`,label);
await db.exec(`update vehicles set factory_warranty_unlimited=true,factory_warranty_km=null,mileage=null,mileage_confirmed=false where id='${car}'`);passed++;
await db.exec(`update vehicles set third_party_warranty='available',warranty_price=null where id='${car}'`);passed++;
// Publishing uses the existing real-photo checks and locks all benefit changes.
await db.exec('reset role');await db.exec(`insert into storage.objects(bucket_id,name) values('vehicle-photos','${car}/20000000-0000-4000-8000-000000000001.webp');`);await as('admin');
await db.exec(`insert into vehicle_photos(vehicle_id,path,position) values('${car}','${car}/20000000-0000-4000-8000-000000000001.webp',0);update vehicles set publication='published' where id='${car}'`);
await fails(`update vehicles set full_service_record=true where id='${car}'`,'published vehicle remains locked');
await as('anon');assert.equal((await db.query(`select third_party_warranty from vehicles where id='${car}'`)).rows[0].third_party_warranty,'available');passed++;
await as('admin');await db.exec(`update vehicles set publication='draft' where id='${car}';update vehicles set factory_warranty=false,third_party_warranty='none',full_service_record=false where id='${car}'`);assert((await db.query(`select count(*)::int as n from inventory_audit where actor='${ids.admin}' and row_id='${car}'`)).rows[0].n>0);passed++;
await db.close();console.log(passed+' vehicle benefit database checks passed');
})().catch(error=>{console.error(error);process.exitCode=1});
