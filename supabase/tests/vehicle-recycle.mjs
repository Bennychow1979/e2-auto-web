import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {operationsDatabase} from '../../tests/fixtures/operations-db.mjs';
const {db,ids,as,rpc}=await operationsDatabase();
try{
 for(const f of ['202609180001_drive_photos','202609210001_vehicle_import','202609210003_plate_only_import','202610010001_vehicle_translation','202610210004_plate_drafts','202610210005_enrich_plate_drafts','202610220001_vehicle_recycle'])await db.exec(await readFile('supabase/migrations/'+f+'.sql','utf8'));
 const read=async id=>(await db.query('select * from public.vehicles where id=$1',[id])).rows[0];
 const action=async(id,op,note='',plate='')=>{const v=await read(id);return (await db.query('select public.e2_vehicle_lifecycle($1,$2,$3,$4,$5) result',[id,op,v.lifecycle_revision,note,plate])).rows[0].result;};
 const create=async plate=>{await as('admin');const id=randomUUID();await db.query('insert into vehicles(id,plate,import_pending) values($1,$2,true)',[id,plate]);return id;};
 const id=await create('RECYCLE1');
 const before=await read(id);
 await assert.rejects(()=>db.query("update vehicles set lifecycle_state='trash' where id=$1",[id]),/Use|use lifecycle/);
 await action(id,'remove','duplicate');assert.equal((await read(id)).lifecycle_state,'trash');
 await as('anon');assert.equal((await db.query('select id from vehicles where id=$1',[id])).rows.length,0);
 await as('sales');assert.equal((await db.query('select id from vehicles where id=$1',[id])).rows.length,0);
 await assert.rejects(()=>db.query("select e2_vehicle_lifecycle($1,'restore',2)",[id]),/Admin access/);
 await as('admin');await assert.rejects(()=>db.query("update vehicles set brand='Changed' where id=$1",[id]),/Restore/);
 await assert.rejects(()=>rpc('e2_save_runner_job',{request_id:randomUUID(),details:{vehicle_id:id,assigned_to:ids.runner,kind:'other',origin:'Demo A',destination:'Demo B'}}),/Restore|recycle/);
 assert(!(await rpc('e2_operations_workspace')).vehicles.some(v=>v.id===id));
 await action(id,'restore');assert.equal((await read(id)).publication,'draft');assert.equal((await read(id)).id,id);
 await assert.rejects(()=>db.query("select e2_vehicle_lifecycle($1,'remove',$2,'stale')",[id,before.lifecycle_revision]),/changed/);
 const job=await rpc('e2_save_runner_job',{request_id:randomUUID(),details:{vehicle_id:id,assigned_to:ids.runner,kind:'other',origin:'Demo A',destination:'Demo B'}});
 await action(id,'remove','archive linked');assert.equal((await read(id)).lifecycle_state,'archived');
 assert((await rpc('e2_operations_workspace')).jobs.some(j=>j.id===job.id));
 await assert.rejects(()=>action(id,'purge_begin','','RECYCLE1'),/business records/);
 await as('runner');const accepted=await rpc('e2_accept_runner_job',{target:job.id,expected_revision:job.revision});assert(accepted);
 await as('admin');await action(id,'restore');assert((await rpc('e2_operations_workspace')).jobs.some(j=>j.id===job.id));
 // Existing inspection + bill history stays intact and forces archive.
 await as('inspector');const claim=await rpc('e2_save_ops_claim',{request_id:randomUUID(),details:{kind:'repair',inspection_id:ids.inspection,supplier:'Demo Garage',expense_date:'2026-10-22',amount:80,description:'Test repair'}});
 await as('admin');await action(ids.car,'remove','has inspection bill');assert.equal((await read(ids.car)).lifecycle_state,'archived');assert((await rpc('e2_operations_workspace')).claims.some(c=>c.id===claim.id));await assert.rejects(()=>action(ids.car,'purge_begin','','DEMO01'),/business records/);
 // Actual uploaded-photo cleanup: metadata stays until storage deletion succeeds.
 const photoCar=await create('RECYCLE2'),photo=randomUUID(),path=photoCar+'/'+randomUUID()+'.webp';
 await db.query("insert into storage.objects(bucket_id,name,metadata) values('vehicle-photos',$1,'{}')",[path]);
 await db.query('insert into vehicle_photos(id,vehicle_id,path,position) values($1,$2,$3,0)',[photo,photoCar,path]);
 await action(photoCar,'remove','photo test');await action(photoCar,'restore');assert.equal((await db.query('select id from vehicle_photos where vehicle_id=$1',[photoCar])).rows.length,1);
 await action(photoCar,'remove','permanent test');
 await assert.rejects(()=>db.query("insert into storage.objects(bucket_id,name) values('vehicle-photos',$1)",[photoCar+'/'+randomUUID()+'.webp']),/row-level security/);
 const realAdmin=randomUUID();await db.exec('reset role');await db.query('insert into auth.users values($1,$2,now())',[realAdmin,'local-admin@example.test']);await db.query("insert into staff_memberships(user_id,role) values($1,'admin')",[realAdmin]);ids.regularAdmin=realAdmin;
 await as('regularAdmin');await assert.rejects(()=>action(photoCar,'purge_begin','','RECYCLE2'),/Super Admin/);
 await as('admin');await assert.rejects(()=>action(photoCar,'purge_begin','','WRONG'),/confirmation/);
 const purge=await action(photoCar,'purge_begin','','RECYCLE2');assert.deepEqual(purge.paths,[path]);
 await assert.rejects(()=>action(photoCar,'restore'),/Only recycled/);
 await assert.rejects(()=>action(photoCar,'purge_finish','','RECYCLE2'),/cleanup is incomplete/);
 await as('regularAdmin');await db.query("delete from storage.objects where bucket_id='vehicle-photos' and name=$1",[path]);
 await db.exec('reset role');assert.equal((await db.query('select count(*)::int n from storage.objects where name=$1',[path])).rows[0].n,1,'regular admin cannot delete purging storage');
 await as('admin');await db.query("delete from storage.objects where bucket_id='vehicle-photos' and name=$1",[path]);await action(photoCar,'purge_finish','','RECYCLE2');assert.equal(await read(photoCar),undefined);
 await assert.rejects(()=>db.query("insert into vehicles(plate,import_pending) values('RECYCLE2',true)"),/permanently deleted/);
 assert.equal((await db.query('select count(*)::int n from vehicle_lifecycle_audit where vehicle_id=$1',[photoCar])).rows[0].n,5);
 // Direct SQL DELETE is not available to staff, even Super Admin.
 await assert.rejects(()=>db.query('delete from vehicles where id=$1',[id]),/permission denied/);
 // Import cannot enrich a removed draft or resurrect a permanently deleted plate.
 const plan=plate=>({vehicle:{plate,brand:'TOYOTA',model:'Test',year:2020,engine_litres:1.5,transmission:'Auto',price:10000},items:[{folder_id:'folder_'+plate,file_id:'photo_'+plate,checksum:'a'.repeat(32),mime_type:'image/jpeg',size_bytes:100}],sheet:'OCT',row:1,review:[]});
 const imported=async plate=>{await db.exec('reset role');return (await db.query('select e2_import_drive_vehicle($1,$2,$3,$4,$5) result',[ids.admin,'folder_'+plate,'stamp','source',plan(plate)])).rows[0].result;};
 const removed=await create('RECYCLE3');await action(removed,'remove','import exclusion');
 assert.equal((await imported('RECYCLE3')).status,'existing');assert.equal((await read(removed)).brand,null);
 assert.equal((await imported('RECYCLE2')).vehicle_id,null);assert.equal((await db.query("select id from vehicles where plate='RECYCLE2'")).rows.length,0);
 await as('admin');await assert.rejects(()=>db.query("insert into vehicles(plate,import_pending,lifecycle_state) values('BADSTATE',true,'trash')"),/lifecycle actions/);
 // Published vehicle removal is two-phase internally and never restores publication.
 const pub=ids.car2,pubPath=pub+'/'+randomUUID()+'.webp';
 await db.query("insert into storage.objects(bucket_id,name) values('vehicle-photos',$1)",[pubPath]);await db.query('insert into vehicle_photos(vehicle_id,path,position) values($1,$2,0)',[pub,pubPath]);
 await db.query("update vehicles set publication='published' where id=$1",[pub]);
 await as('anon');assert.equal((await db.query('select id from vehicles where id=$1',[pub])).rows.length,1);
 await as('admin');await action(pub,'remove','unpublish');
 await assert.rejects(()=>db.query('delete from vehicle_photos where vehicle_id=$1',[pub]),/Restore vehicle/);
 await as('anon');assert.equal((await db.query('select id from vehicles where id=$1',[pub])).rows.length,0);
 await as('admin');await action(pub,'restore');assert.equal((await read(pub)).publication,'draft');
 console.log('Vehicle recycle SQL passed: RLS, roles, immutable state, revision guards, archive history/claims, continued Runner work, storage failure/retry, exact-plate purge and import tombstones.');
}finally{await db.close();}
