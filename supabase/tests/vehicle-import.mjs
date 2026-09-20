import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ExcelJS from 'exceljs';
import {PGlite} from '@electric-sql/pglite';
import {MASTERLIST,period,selectSheet,sourceRows,makePlan,modelIdentity} from '../functions/e2-vehicle-import/plan.mjs';
import {runImport} from '../functions/e2-vehicle-import/run.mjs';
const when={year:2026,month:9},now=new Date('2026-09-21T01:00:00Z'),actor='00000000-0000-4000-8000-000000000001',root='root_1234567890';
const folder={id:'folder_1234567890',name:'TCK8286 BMW 218I',mimeType:'application/vnd.google-apps.folder',parents:[root]};
const photo={id:'photo_1234567890',name:'2.jpg',mimeType:'image/jpeg',parents:[folder.id],size:100,md5Checksum:'a'.repeat(32),capabilities:{canDownload:true}};
function fixture() {
  const w=new ExcelJS.Workbook(),s=w.addWorksheet('SEPT');
  // MUDAH PRICE deliberately placed first, not L. Private columns never enter projected rows.
  s.addRow(['MUDAH PRICE','No Plate','Brand','Model','YRS','CC','A/M','DATE IN','PROFIT','CUSTOMER']);
  s.addRow([81990,'TCK8286','BMW','218I M SPORT',2021,1.5,'A',new Date('2026-09-04'),99999,'PRIVATE']);
  return w;
}
assert.deepEqual(period(new Date('2026-09-30T16:00:00Z')),{year:2026,month:10});
const book=fixture(),buffer=await book.xlsx.writeBuffer(),loaded=new ExcelJS.Workbook();await loaded.xlsx.load(buffer);
const rows=sourceRows(loaded,when,new Set(['TCK8286']));
assert.equal(rows.get('TCK8286')[0].price,'81990');
assert.ok(!JSON.stringify([...rows]).includes('PRIVATE'));
const plan=makePlan(folder,rows.get('TCK8286'),[{...photo,name:'10.jpg',id:photo.id+'2',md5Checksum:'b'.repeat(32)},photo,{...photo,id:photo.id+'copy'}],when);
assert.equal(plan.items.length,2);assert.equal(plan.items[0].file_id,photo.id);assert.equal(plan.skipped,1);
assert.equal(plan.vehicle.model,'218i');assert.equal(plan.vehicle.variant,'');
assert.deepEqual(modelIdentity('MAZDA','CX-5 SKYACTIV-G High TC'),{brand:'MAZDA',model:'CX-5'});
assert.throws(()=>modelIdentity('BMW','X30'),/confirmation/);
assert.equal(modelIdentity('BMW','X3 2.0 2021').model,'X3');
assert.equal(modelIdentity('MERCEDES-BENZ','GLC250 4MATIC AMG LINE').model,'GLC250');
assert.equal(modelIdentity('MAZDA','Cx-5 2.5 tc high 2019').model,'CX-5');
assert.throws(()=>selectSheet(book,{year:2026,month:10}),/current-month/);
book.addWorksheet('SEPTEMBER');assert.throws(()=>selectSheet(book,when),/Exactly one/);book.removeWorksheet('SEPTEMBER');
for(const [column,value,error] of [[1,0,/PRICE/],[1,{formula:'1+1',result:81990},/Formula/],[5,'2021/2022',/Year/],[6,1498,/units/],[7,'?',/Transmission/]]) {
  const w=fixture();w.getWorksheet('SEPT').getCell(2,column).value=value;
  assert.throws(()=>makePlan(folder,sourceRows(w,when,new Set(['TCK8286'])).get('TCK8286'),[photo],when),error);
}
const old=fixture();old.getWorksheet('SEPT').getCell('H2').value=new Date('2025-09-04');assert.throws(()=>sourceRows(old,when,new Set()),/this year/);
assert.throws(()=>makePlan({...folder,name:'W2133A CIVIC'},[],[photo],when),/conflict/);
assert.throws(()=>makePlan(folder,[...rows.get('TCK8286'),...rows.get('TCK8286')],[photo],when),/Duplicate/);
assert.throws(()=>makePlan({...folder,name:'TCK8286 BMW X3'},rows.get('TCK8286'),[photo],when),/conflict/);
assert.throws(()=>makePlan(folder,rows.get('TCK8286'),Array.from({length:31},(_,n)=>({...photo,id:photo.id+n,md5Checksum:n.toString(16).padStart(32,'0')})),when),/30/);

// Exercise actual SQL constraints, private visibility, deduplication and atomic rollback.
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create schema storage;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema public,auth,storage to anon,authenticated,service_role;
grant select,insert,update,delete on storage.objects to anon,authenticated;
grant execute on function auth.uid() to anon,authenticated;`);
for(const m of ['202609120001_inventory','202609130002_photo_order','202609130003_photo_limit_30','202609130004_super_admin','202609170013_optional_vehicle_spec','202609180001_drive_photos','202609210001_vehicle_import'])await db.exec(readFileSync('supabase/migrations/'+m+'.sql','utf8'));
await db.query('insert into auth.users(id) values($1)',[actor]);await db.query("insert into public.staff_memberships(user_id,role) values($1,'admin')",[actor]);
async function as(role){await db.exec('reset role;set role '+role)}
async function commit(p=plan,f=folder.id,a=actor){return (await db.query('select public.e2_import_drive_vehicle($1,$2,$3,$4,$5) result',[a,f,'stamp','source',JSON.stringify(p)])).rows[0].result}
await as('authenticated');await assert.rejects(()=>commit(),/permission denied/);
await as('service_role');await assert.rejects(()=>commit(plan,folder.id,'00000000-0000-4000-8000-000000000002'),/Admin/);
const saved=await commit();assert.equal(saved.status,'created');
assert.equal((await commit()).status,'existing');
const state=(await db.query('select publication,price,mileage,mileage_confirmed,variant from public.vehicles')).rows[0];
assert.equal(state.publication,'draft');assert.equal(Number(state.price),81990);assert.equal(state.mileage,null);assert.equal(state.mileage_confirmed,false);assert.equal(state.variant,'');
assert.equal((await db.query('select count(*)::int n from public.vehicle_photos')).rows[0].n,2);
await db.query("update public.vehicle_import_jobs set status='blocked' where folder_id=$1",[folder.id]);
assert.equal((await db.query('select status from public.vehicle_import_jobs')).rows[0].status,'completed');
const bad=structuredClone(plan);bad.vehicle.plate='ABC1234';bad.items[1].mime_type='text/html';
await assert.rejects(()=>commit(bad,folder.id+'new'),/folder mismatch/);
bad.items.forEach(i=>i.folder_id=folder.id+'new');await assert.rejects(()=>commit(bad,folder.id+'new'),/check constraint/);
assert.equal((await db.query('select count(*)::int n from public.vehicles')).rows[0].n,1,'Invalid photo rolls back vehicle insertion');
await as('postgres');await db.exec("update public.vehicles set plate='TC-K8286'");
await as('service_role');const duplicate=structuredClone(plan);duplicate.items.forEach(i=>i.folder_id=folder.id+'again');
assert.equal((await commit(duplicate,folder.id+'again')).status,'existing','Dedup normalizes punctuation across all inventory');
await as('anon');assert.equal((await db.query('select count(*)::int n from public.vehicles')).rows[0].n,0);
await assert.rejects(()=>db.query('select * from public.vehicle_import_jobs'),/permission denied/);
await as('postgres');await db.close();

// Integration: zero photo bytes/AI calls, unchanged blocked cache, retry after uncertain commit.
let downloads=0,commits=0,inventory=[],jobs=new Map(),failAfterCommit=false;
const drive={list:async id=>id===root?[folder]:[photo],metadata:async id=>id===MASTERLIST?{mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',md5Checksum:'c'.repeat(32),version:'1'}:folder,
  workbook:async()=>{downloads++;return buffer},image:async()=>{throw Error('Photos must never be downloaded during import')}};
const store={inventory:async()=>inventory,jobs:async()=>jobs,save:async j=>jobs.set(j.folder_id,j),
  commit:async()=>{commits++;inventory=[{plate:'TCK8286'}];if(failAfterCommit)throw Error('Uncertain network result');return {status:'created',vehicle_id:'saved'}},
  verify:async()=>({publication:'draft',price:81990,photos:[{file_id:photo.id}]})};
const loadWorkbook=async b=>{const w=new ExcelJS.Workbook();await w.xlsx.load(b);return w};
const args={drive,store,loadWorkbook,root,actor,now};
const success=await runImport(args);assert.equal(success.created.length,1);assert.equal(commits,1);assert.equal(downloads,1);
await runImport(args);assert.equal(downloads,1,'Existing inventory skips workbook download');assert.equal(commits,1);
inventory=[];failAfterCommit=true;
assert.match((await runImport(args)).error,/Uncertain/);await runImport(args);assert.equal(commits,2,'Unknown save outcome retries never duplicate a car');
inventory=[];failAfterCommit=false;const missing=fixture();missing.getWorksheet('SEPT').getCell('B2').value='OTHER123';
const blockedArgs={...args,loadWorkbook:async()=>missing};
assert.equal((await runImport(blockedArgs)).blocked.length,1);
const before=downloads;assert.equal((await runImport(blockedArgs)).unchanged,1);assert.equal(downloads,before);
assert.ok((await runImport({...args,loadWorkbook:async()=>old})).error===undefined,'Unchanged blocker uses cache');
assert.match((await runImport({...args,retry:true,loadWorkbook:async()=>old})).error,/this year/);
console.log('Vehicle importer: workbook, planning, SQL/RLS, atomic retry and no-photo-download tests passed.');
