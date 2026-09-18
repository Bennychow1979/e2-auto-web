import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {folderId,matchesPlate,checkFolder,uniquePhotos,signTicket,readTicket,MAX_BYTES} from '../functions/e2-drive-photos/core.mjs';
import {googleDrive} from '../functions/e2-drive-photos/google.mjs';
import {resolvePhotoURLs} from '../../photo-urls.mjs';

const folder='folder_1234567890',file='file_1234567890',root='root_1234567890';
assert.equal(folderId('https://drive.google.com/drive/folders/'+folder+'?usp=sharing'),folder);
for(const bad of ['https://evil.example/drive/folders/'+folder,'https://drive.google.com.evil.test/drive/folders/'+folder,'https://user:password@drive.google.com/drive/folders/'+folder,'http://drive.google.com/drive/folders/'+folder,'javascript:alert(1)'])
  assert.throws(()=>folderId(bad));
assert.ok(matchesPlate('VBH4735 CIVIC FD','VBH4735'));
assert.ok(!matchesPlate('WB2133A CIVIC','W2133A'));
assert.ok(!matchesPlate('JC5501J CERATO','JC5501'));
assert.ok(!matchesPlate('VBH47350 CIVIC','VBH4735'));
checkFolder({name:'VBH4735 CIVIC',mimeType:'application/vnd.google-apps.folder',parents:[root]},root,'VBH4735');
assert.throws(()=>checkFolder({name:'VBH4735 CIVIC',mimeType:'application/vnd.google-apps.folder',parents:['wrong']},root,'VBH4735'));
const photo={id:file,name:'car.jpg',mimeType:'image/jpeg',parents:[folder],size:100,md5Checksum:'a'.repeat(32),capabilities:{canDownload:true}};
assert.deepEqual(uniquePhotos([photo,{...photo,id:file+'2'},{...photo,id:file+'3',size:MAX_BYTES+1},{...photo,id:file+'4',parents:['other']},{...photo,id:file+'5',capabilities:{canDownload:false}}],folder),{photos:[photo],skipped:4});
const secret='test-only-signing-key-at-least-32-characters';
const token=await signTicket({kind:'photo',id:file},secret,1000);
assert.equal((await readTicket(token,secret,1001)).id,file);
await assert.rejects(()=>readTicket(token,secret,1300));
await assert.rejects(()=>readTicket(token+'x',secret,1001));
await assert.rejects(()=>readTicket(token,'another-test-signing-key-at-least-32',1001));
await assert.rejects(()=>readTicket(token,secret,900));

const album=[{id:'u',path:'u.webp'},{id:'d',path:'d.drive',source:'drive'},{id:'u2',path:'u2.webp',source:'upload'}];
const resolved=await resolvePhotoURLs(album,{
  uploaded:async photos=>{assert.deepEqual(photos.map(p=>p.id),['u','u2']);return [{signedUrl:'upload-1'},{signedUrl:'upload-2'}]},
  drive:async ids=>{assert.deepEqual(ids,['d']);return [{id:'d',url:'drive-1'}]}
});
assert.deepEqual(resolved.map(p=>p.url),['upload-1','drive-1','upload-2']);
const outage=await resolvePhotoURLs(album,{uploaded:async()=>[{signedUrl:'upload-1'},{signedUrl:'upload-2'}],drive:async()=>{throw Error('offline')}});
assert.deepEqual(outage.map(p=>p.url),['upload-1',null,'upload-2']);

// Exercise the real Google adapter: token caching, size, MIME and checksum checks.
const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const pem=Buffer.from(await crypto.subtle.exportKey('pkcs8',keys.privateKey)).toString('base64');
const bytes=new Uint8Array([255,216,255,1,2,3]),checksum=createHash('md5').update(bytes).digest('hex');
let tokens=0,content=bytes;
const google=googleDrive({client_email:'test@example.test',private_key:'-----BEGIN PRIVATE KEY-----\n'+pem+'\n-----END PRIVATE KEY-----'},async(url,options)=>{
  if(String(url)==='https://oauth2.googleapis.com/token'){tokens++;assert.ok(String(options.body).includes('assertion='));return Response.json({access_token:'test-only',expires_in:3600})}
  assert.equal(new URL(url).hostname,'www.googleapis.com');assert.equal(options.headers.Authorization,'Bearer test-only');
  return new Response(content);
});
assert.deepEqual(await google.image(file,checksum,'image/jpeg'),bytes);
await assert.rejects(()=>google.image(file,'0'.repeat(32),'image/jpeg'),/changed/);
await assert.rejects(()=>google.image(file,checksum,'image/png'),/supported/);
assert.equal(tokens,1);
content=new Uint8Array(MAX_BYTES+1);
await assert.rejects(()=>google.image(file,checksum,'image/jpeg'),/20 MB/);

const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema public,auth,storage to anon,authenticated,service_role;
grant select,insert,update,delete on storage.objects to anon,authenticated;
grant execute on function auth.uid() to anon,authenticated;`);
for(const migration of ['202609120001_inventory.sql','202609130002_photo_order.sql','202609130003_photo_limit_30.sql','202609130004_super_admin.sql'])
  await db.exec(readFileSync('supabase/migrations/'+migration,'utf8'));
const admin='00000000-0000-4000-8000-000000000001',sales='00000000-0000-4000-8000-000000000002',car='10000000-0000-4000-8000-000000000001',uploaded='20000000-0000-4000-8000-000000000001';
async function as(role,id=''){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role '+role)}
async function scalar(sql,args=[]){return (await db.query(sql,args)).rows[0]}
await db.exec(`insert into auth.users(id) values('${admin}'),('${sales}');
insert into public.staff_memberships(user_id,role) values('${admin}','admin'),('${sales}','sales');`);
await as('authenticated',admin);
await db.exec(`insert into public.vehicles(id,plate,brand,model,variant,year,engine_litres,transmission,fuel_type,price) values('${car}','VBH4735','Honda','Civic','S',2011,1.8,'Auto','PETROL',29990);
insert into storage.objects(bucket_id,name) values('vehicle-photos','${car}/${uploaded}.webp');
insert into public.vehicle_photos(id,vehicle_id,path,position) values('${uploaded}','${car}','${car}/${uploaded}.webp',0);`);
await as('postgres');
await db.exec(readFileSync('supabase/migrations/202609180001_drive_photos.sql','utf8'));
assert.deepEqual(await scalar('select source,position from public.vehicle_photos'),{source:'upload',position:0});
const item={folder_id:folder,file_id:file,checksum:'a'.repeat(32),mime_type:'image/jpeg',size_bytes:100};
async function attach(items=[item],actor=admin,plate='VBH4735'){return db.query('select public.e2_attach_drive_photos($1,$2,$3,$4) added',[actor,car,plate,JSON.stringify(items)])}
await as('authenticated',admin);
await assert.rejects(()=>attach(),/permission denied/);
await assert.rejects(()=>db.query('select * from public.vehicle_drive_photos'),/permission denied/);
await assert.rejects(()=>db.exec(`insert into public.vehicle_photos(vehicle_id,path,position,source) values('${car}','${car}/fake.drive',1,'drive')`),/Drive photo service/);
await as('service_role');
await assert.rejects(()=>attach([item],sales),/Admin access/);
await assert.rejects(()=>attach([item],admin,'OTHER123'),/details changed/);
assert.equal((await attach()).rows[0].added,1);
assert.equal((await attach()).rows[0].added,0,'Uncertain retries do not duplicate links');
assert.equal((await attach([{...item,file_id:file+'duplicate'}])).rows[0].added,0,'Duplicate content is skipped');
await assert.rejects(()=>attach([{...item,checksum:'b'.repeat(32)}]),/file changed/);
const drivePhoto=(await scalar("select id from public.vehicle_photos where source='drive'")).id;
await as('authenticated',admin);
await db.query('select public.e2_set_cover($1)',[drivePhoto]);
assert.equal((await scalar('select id from public.vehicle_photos order by position limit 1')).id,drivePhoto);
await db.query('select public.e2_reorder_photos($1,$2::uuid[],$3::uuid[])',[car,[uploaded,drivePhoto],[drivePhoto,uploaded]]);
await as('anon');
assert.equal((await scalar('select count(*)::int n from public.vehicle_photos')).n,0);
await assert.rejects(()=>db.query('select * from public.vehicle_drive_photos'),/permission denied/);
await as('authenticated',admin);
await db.exec(`delete from public.vehicle_photos where id='${uploaded}';update public.vehicles set publication='published' where id='${car}'`);
await as('anon');
assert.equal((await scalar("select count(*)::int n from public.vehicle_photos where source='drive'")).n,1,'A Drive-only vehicle can publish');
await as('service_role');
await assert.rejects(()=>attach(),/Move vehicle to draft/);
await as('authenticated',admin);
await db.exec(`update public.vehicles set publication='draft' where id='${car}'`);
await as('service_role');
const extra=Array.from({length:30},(_,i)=>({...item,file_id:'extra_file_'+i,checksum:(i+1).toString(16).padStart(32,'0')}));
await assert.rejects(()=>attach(extra),/Maximum 30/);
assert.equal((await scalar('select count(*)::int n from public.vehicle_photos')).n,1,'Overflow rolls back the entire batch');
await as('authenticated',admin);
await db.query('delete from public.vehicle_photos where id=$1',[drivePhoto]);
await assert.rejects(()=>db.exec(`update public.vehicles set publication='published' where id='${car}'`),/real vehicle photo/);
await as('service_role');
assert.equal((await scalar('select count(*)::int n from public.vehicle_drive_photos')).n,0,'Removing a link clears private metadata');
await as('postgres');
assert.equal((await scalar('select count(*)::int n from storage.objects')).n,1,'Link deletion never removes uploaded objects');
await db.close();
console.log('PASS Drive photo sources, URL validation, exact plates, private metadata, signed access, content integrity, mixed order, retries, draft permissions and limits');
