const {PGlite}=require('@electric-sql/pglite');const fs=require('node:fs');const assert=require('node:assert/strict');
(async()=>{const db=new PGlite();let passed=0;
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));
alter table storage.objects enable row level security;grant usage on schema public,auth,storage to anon,authenticated,service_role;
grant select,insert,update,delete on storage.objects to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
for(const f of ['202609120001_inventory.sql','202609130002_photo_order.sql','202609130003_photo_limit_30.sql','202609130004_super_admin.sql','202609130005_staff_profiles.sql','202609130006_customers.sql','202609140006_saved_vehicles.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
const ids=Array.from({length:8},(_,i)=>'00000000-0000-4000-8000-00000000000'+(i+1));
const [owner,admin,sales,account,customer,other,unconfirmed,inactive]=ids;
for(const [i,id] of ids.entries())await db.query('insert into auth.users values($1,$2,$3)',[id,'customer'+i+'@example.test',i===6?null:new Date().toISOString()]);
for(const [id,role,active] of [[owner,'super_admin',true],[admin,'admin',true],[sales,'sales',true],[account,'account',true],[inactive,'customer',false]])await db.query('insert into public.staff_memberships(user_id,role,active) values($1,$2,$3)',[id,role,active]);
async function as(id){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec('set role '+(id?'authenticated':'anon'))}
async function yes(sql,value,label){assert.equal((await db.query(sql)).rows[0].value,value);passed++;console.log('PASS '+label)}
async function no(sql,label){await assert.rejects(db.exec(sql));passed++;console.log('PASS '+label)}

await db.exec('reset role');
const cars=[];
for(let i=0;i<102;i++){
 const id=(await db.query("insert into public.vehicles(plate,brand,model,variant,year,engine_litres,transmission,fuel_type,price) values($1,'Test','Car','Auto',2020,1.5,'Auto','PETROL',50000) returning id",['TEST'+i])).rows[0].id;cars.push(id);
 const photo=require('node:crypto').randomUUID(),path=id+'/'+photo+'.webp';
 await db.query("insert into storage.objects(bucket_id,name) values('vehicle-photos',$1)",[path]);
 await db.query('insert into public.vehicle_photos(id,vehicle_id,path,position) values($1,$2,$3,0)',[photo,id,path]);
 if(i!==101)await db.query("update public.vehicles set publication='published' where id=$1",[id]);
}
const save=(id,keep=true)=>`select public.e2_save_vehicle('${id}',${keep})`;
await as(null);await no('select * from public.saved_vehicles','Anonymous cannot read favourites');await no(save(cars[0]),'Anonymous cannot save');
for(const id of [unconfirmed,inactive]){await as(id);await no(save(cars[0]),'Inactive or unconfirmed cannot save')}
await as(customer);await no(save(cars[101]),'Draft vehicle cannot be saved');await no(save(cars[0],'null'),'Null operation rejected');
await db.exec(save(cars[0]));await db.exec(save(cars[0]));
await yes('select count(*)::integer value from public.saved_vehicles',1,'Repeated save is idempotent');
await yes('select user_id::text value from public.saved_vehicles',customer,'Owner derived from authenticated session');
await no(`insert into public.saved_vehicles values('${other}','${cars[1]}',now())`,'Direct insert cannot spoof owner');
await no(`update public.saved_vehicles set user_id='${other}'`,'Direct update denied');await no('delete from public.saved_vehicles','Direct delete denied');
for(const id of [owner,admin,sales,account,other]){await as(id);await yes('select count(*)::integer value from public.saved_vehicles',0,'Other users including staff cannot see customer shortlist')}
await as(other);await db.exec(save(cars[0],false));await as(customer);await yes('select count(*)::integer value from public.saved_vehicles',1,'Removing another user favourite has no effect');
await db.exec('reset role');await db.query("update public.vehicles set publication='draft' where id=$1",[cars[0]]);await db.query("update public.vehicles set stock_status='Sold' where id=$1",[cars[0]]);await db.query("update public.vehicles set publication='published' where id=$1",[cars[0]]);
await as(customer);await yes("select stock_status value from public.vehicles where id='"+cars[0]+"'",'Sold','Saved vehicle exposes current published availability');
await db.exec('reset role');await db.query("update public.vehicles set publication='draft' where id=$1",[cars[0]]);
await as(customer);await yes('select count(*)::integer value from public.saved_vehicles',1,'Unpublished favourite retains removable reference');await yes("select count(*)::integer value from public.vehicles where id='"+cars[0]+"'",0,'Unpublishing hides private vehicle details');
await db.exec(save(cars[0],false));await db.exec(save(cars[0],false));await yes('select count(*)::integer value from public.saved_vehicles',0,'Unpublished favourite removal is idempotent');
await db.exec('reset role');await db.query("update public.vehicles set publication='published' where id=$1",[cars[0]]);await as(customer);
for(let i=0;i<100;i++)await db.exec(save(cars[i]));await no(save(cars[100]),'Shortlist capped at 100');await db.exec(save(cars[0]));await yes('select count(*)::integer value from public.saved_vehicles',100,'Already saved car allowed at cap');
await db.exec(save(cars[0],false));await db.exec(save(cars[100]));await yes('select count(*)::integer value from public.saved_vehicles',100,'Removing makes room for another car');
await db.exec('reset role');await db.query("insert into public.staff_memberships(user_id,role,active) values($1,'customer',false)",[customer]);await as(customer);
await yes('select count(*)::integer value from public.saved_vehicles',0,'Deactivated account cannot read saved cars');await no(save(cars[1],false),'Deactivated account cannot mutate saved cars');
await db.close();console.log(passed+' saved-car authorization checks passed.');
})().catch(e=>{console.error(e);process.exit(1)});
