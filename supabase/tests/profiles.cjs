const {PGlite}=require('@electric-sql/pglite');const fs=require('node:fs');const assert=require('node:assert/strict');
(async()=>{const db=new PGlite();let passed=0;
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));
alter table storage.objects enable row level security;grant usage on schema public,auth,storage to anon,authenticated,service_role;
grant select,insert,update,delete on storage.objects to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;`);
for(const f of ['202609120001_inventory.sql','202609130002_photo_order.sql','202609130003_photo_limit_30.sql','202609130004_super_admin.sql','202609130005_staff_profiles.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
const ids=Array.from({length:6},(_,i)=>'00000000-0000-4000-8000-00000000000'+(i+1)),[owner,admin,sales,account,customer,inactive]=ids;
for(const [i,id] of ids.entries()){await db.query('insert into auth.users values($1,$2,now())',[id,'p'+i+'@example.test']);await db.query('insert into public.staff_memberships(user_id,role,active) values($1,$2,$3)',[id,['super_admin','admin','sales','account','customer','sales'][i],i!==5])}
async function as(id){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec('set role '+(id?'authenticated':'anon'))}
async function yes(sql,value,label){assert.equal((await db.query(sql)).rows[0].value,value);passed++;console.log('PASS '+label)}
async function no(sql,label){await assert.rejects(db.exec(sql));passed++;console.log('PASS '+label)}
const data={display_name:'Test Staff',position:'Sales Consultant',whatsapp:'60123456789',languages:'English, 中文',bio:'Ask me about E2 cars.'};
const save=(id,rev,extra={})=>"select public.e2_save_profile('"+id+"','"+JSON.stringify({...data,...extra}).replaceAll("'","''")+"'::jsonb,"+rev+")";
const publish=(id,rev,value=true)=>"select public.e2_publish_profile('"+id+"',"+value+","+rev+")";
const photo=sales+'/10000000-0000-4000-8000-000000000001.webp';
await as(sales);await db.exec(save(sales,0,{is_public:true}));await yes('select is_public value from public.staff_profiles',false,'Self save stays private even with injected public flag');
await no(save(admin,0),'Sales cannot edit another employee');
await no(publish(sales,1),'Sales cannot self publish');
await no("update public.staff_profiles set is_public=true",'Direct publication bypass denied');
await no(save(sales,0),'Stale save rejected');
await no(save(sales,1,{whatsapp:'javascript:alert(1)'}),'Invalid WhatsApp rejected');
await no(save(sales,1,{photo_path:photo}),'Missing photo object rejected');
await db.exec("insert into storage.objects(bucket_id,name) values('staff-photos','"+photo+"')");
await no("insert into storage.objects(bucket_id,name) values('staff-photos','"+admin+"/10000000-0000-4000-8000-000000000002.webp')",'Cannot upload into another employee folder');
await db.exec(save(sales,1,{photo_path:photo}));
await yes("select count(*)::integer value from storage.objects where bucket_id='staff-photos'",1,'Owner reads private uploaded photo');
await yes("with deleted as(delete from storage.objects where name='"+photo+"' returning id) select count(*)::integer value from deleted",0,'Referenced portrait cannot be deleted');
await as(admin);await yes('select count(*)::integer value from public.staff_profiles',0,'Admin cannot read another private profile');
await no(save(sales,2),'Admin cannot edit another profile');
await no(publish(sales,2),'Admin cannot publish profiles');
await as(account);await db.exec(save(account,0));await yes("select count(*)::integer value from public.staff_profiles",1,'Account staff can save only their own private profile');
for(const id of [null,customer,inactive]){await as(id);await yes('select count(*)::integer value from public.staff_profiles',0,'Unauthorized actor cannot read private profiles');await no(save(id||sales,0),'Unauthorized actor cannot save profile');await yes("select count(*)::integer value from storage.objects where bucket_id='staff-photos'",0,'Unauthorized actor cannot read private portrait')}
await as(owner);await yes('select count(*)::integer value from public.staff_profiles',2,'Super Admin sees all staff profiles');await db.exec(publish(sales,2));
await as(null);await yes('select count(*)::integer value from public.staff_profiles',1,'Public reads only published active profile');await yes("select count(*)::integer value from storage.objects where bucket_id='staff-photos'",1,'Published portrait readable');await no(save(sales,3),'Public cannot save');
await as(sales);await db.exec(save(sales,3,{photo_path:photo,bio:'Changed'}));
await as(null);await yes('select count(*)::integer value from public.staff_profiles',0,'Self edits remove public visibility');await yes("select count(*)::integer value from storage.objects where bucket_id='staff-photos'",0,'Edited portrait becomes private');
await as(owner);await no(publish(sales,3),'Stale publication rejected');await db.exec(publish(sales,4));
await db.exec("select public.e2_update_staff('"+sales+"','sales',false,1)");
await as(null);await yes('select count(*)::integer value from public.staff_profiles',0,'Inactive staff disappears from public');await yes("select count(*)::integer value from storage.objects where bucket_id='staff-photos'",0,'Inactive portrait denied');
await as(sales);await no(save(sales,5),'Disabled staff cannot edit profile');
await as(owner);await db.exec(save(sales,5,{photo_path:null}));await db.exec("delete from storage.objects where name='"+photo+"'");await yes("select count(*)::integer value from storage.objects where bucket_id='staff-photos'",0,'Detached photo can be cleaned up by Super Admin');
await no(publish(sales,6),'Cannot publish disabled staff');
await db.exec(save(admin,0,{whatsapp:''}));await no(publish(admin,1),'WhatsApp required before publishing');
await yes("select count(*)::integer value from public.staff_access_audit where action='SAVE_PROFILE'",6,'Profile changes audited');
const {normalizeWhatsApp,whatsappLink}=await import('../../profile-utils.js');
assert.equal(normalizeWhatsApp('012-345 6789'),'60123456789');assert.equal(normalizeWhatsApp('+65 8123 4567'),'6581234567');assert.equal(normalizeWhatsApp('0060 12 3456789'),'60123456789');assert.throws(()=>normalizeWhatsApp('6012<script>'));assert.ok(whatsappLink('+60123456789','A & B').startsWith('https://wa.me/60123456789?text='));passed+=5;
await db.close();console.log(passed+' staff profile checks passed.');
})().catch(e=>{console.error(e);process.exit(1)});

