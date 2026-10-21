import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import ExcelJS from 'exceljs';
import {operationsDatabase} from '../../tests/fixtures/operations-db.mjs';
import {runImport} from '../functions/e2-vehicle-import/run.mjs';
import {MASTERLIST} from '../functions/e2-vehicle-import/plan.mjs';

const {db,ids,as,rpc}=await operationsDatabase();
try{
 for(const file of ['202609180001_drive_photos','202609210001_vehicle_import','202609210003_plate_only_import','202610210004_plate_drafts','202610210005_enrich_plate_drafts'])await db.exec(await readFile('supabase/migrations/'+file+'.sql','utf8'));
 const row=async id=>(await db.query('select * from vehicles where id=$1',[id])).rows[0];
 const service=()=>db.exec('reset role;set role service_role');
 const draft=async plate=>{await as('admin');const id=randomUUID();await db.query("insert into vehicles(id,plate,import_pending) values($1,$2,true)",[id,plate]);return id;};
 const plan=(plate,suffix='')=>({vehicle:{plate,brand:'TOYOTA',model:'Corolla Cross',year:2022,engine_litres:1.8,transmission:'Auto',fuel_type:'PETROL',price:95000},plate_aliases:[plate],sheet:'OCT',row:2,review:['Review before publishing'],items:[{folder_id:'folder_'+plate+suffix,file_id:'photo_'+plate+suffix,checksum:'a'.repeat(32),mime_type:'image/jpeg',size_bytes:100}]});
 const commit=async p=>{await service();return (await db.query('select public.e2_import_drive_vehicle($1,$2,$3,$4,$5) result',[ids.admin,p.items[0].folder_id,'stamp','source',p])).rows[0].result;};
 const id=await draft('DEMO88');
 for(const field of ['brand','model','year','engine_litres','transmission','fuel_type','price','mileage'])assert.equal((await row(id))[field],null);
 await assert.rejects(()=>db.query("insert into vehicles(plate) values('NODRAFT1')"),/vehicles_draft_completeness/);
 const job=await rpc('e2_save_runner_job',{request_id:randomUUID(),details:{vehicle_id:id,assigned_to:ids.runner,kind:'carro_pickup',origin:'DEMO Carro',destination:'DEMO Showroom'}});
 await as('sales');await assert.rejects(()=>db.query("insert into vehicles(plate,import_pending) values('DENIED1',true)"),/row-level security/);
 await as('anon');assert.equal((await db.query('select id from vehicles where id=$1',[id])).rows.length,0);
 await as('admin');await db.query("update vehicles set price=90000,description='Keep verified notes',variant='Verified trim',mileage=12345,mileage_confirmed=true where id=$1",[id]);
 // Exercise the actual worker and the actual atomic SQL RPC in one integration.
 const root='root_1234567890',folder={id:'folder_DEMO88',name:'DEMO88 TOYOTA',mimeType:'application/vnd.google-apps.folder',parents:[root]};
 const photo={id:'photo_DEMO88',name:'1.jpg',mimeType:'image/jpeg',parents:[folder.id],size:100,md5Checksum:'a'.repeat(32),capabilities:{canDownload:true}};
 const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('OCT');
 sheet.addRow(['MUDAH PRICE','No Plate','Brand','Model','YRS','CC','A/M','DATE IN']);
 sheet.addRow([95000,'DEMO88','TOYOTA','Corolla Cross',2022,1.8,'A',new Date('2026-10-04')]);
 let downloads=0;
 const drive={list:async target=>target===root?[folder]:[photo],metadata:async target=>target===MASTERLIST?{mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',md5Checksum:'c'.repeat(32),version:'1'}:folder,workbook:async()=>{downloads++;return 'synthetic';}};
 const store={
  inventory:async()=>{await service();return (await db.query("select id,plate,publication,import_pending,(select coalesce(jsonb_agg(jsonb_build_object('id',p.id)),'[]') from vehicle_photos p where p.vehicle_id=v.id) vehicle_photos from vehicles v")).rows;},
  jobs:async()=>new Map((await db.query('select * from vehicle_import_jobs')).rows.map(r=>[r.folder_id,r])),
  save:async()=>{throw Error('Unexpected blocked source');},
  commit:async({plan:p})=>commit(p),
  verify:async target=>({...await row(target),photos:(await db.query('select d.file_id from vehicle_photos p join vehicle_drive_photos d on d.photo_id=p.id where p.vehicle_id=$1 order by p.position',[target])).rows})
 };
 const args={drive,store,loadWorkbook:async()=>book,root,actor:ids.admin,now:new Date('2026-10-21T01:00:00Z')};
 const result=await runImport(args);assert.equal(result.error,undefined);assert.equal(result.created.length,1);assert.equal(result.created[0].updated,true);assert.equal(result.created[0].id,id);assert.equal(result.created[0].price,90000);
 const completed=await row(id);assert.equal(completed.import_pending,false);assert.equal(completed.publication,'draft');assert.equal(completed.brand,'TOYOTA');assert.equal(completed.year,2022);assert.equal(Number(completed.price),90000);assert.equal(completed.description,'Keep verified notes');assert.equal(completed.variant,'Verified trim');assert.equal(completed.mileage,12345);
 await as('admin');assert.equal((await rpc('e2_operations_workspace')).jobs.find(j=>j.id===job.id).vehicle_id,id,'job stays linked to original vehicle');
 await runImport(args);assert.equal(downloads,1,'completed draft is skipped without source download');
 assert.equal((await commit(plan('DEMO88'))).status,'existing');
 assert.equal((await db.query('select count(*)::int n from vehicle_photos where vehicle_id=$1',[id])).rows[0].n,1,'retries do not duplicate photos');
 const broken=await draft('BROKEN1'),bad=plan('BROKEN1');bad.items[0].mime_type='text/html';await assert.rejects(()=>commit(bad),/check constraint/);
 assert.equal((await row(broken)).brand,null);assert.equal((await row(broken)).import_pending,true,'invalid album rolls back details and pending flag');
 // Existing photos, published stock and other complete drafts must not be overwritten.
 const withPhoto=await draft('PHOTO1');await service();
 await db.query('select public.e2_attach_drive_photos($1,$2,$3,$4)',[ids.admin,withPhoto,'PHOTO1',plan('PHOTO1').items]);
 assert.equal((await commit(plan('PHOTO1','new'))).status,'existing');assert.equal((await row(withPhoto)).brand,null);
 await as('admin');await assert.rejects(()=>db.query("update vehicles set publication='published' where id=$1",[withPhoto]),/vehicles_(pending_private|draft_completeness)/);
 await assert.rejects(()=>db.query("update vehicles set publication='published',import_pending=false where id=$1",[withPhoto]),/vehicles_draft_completeness/);
 await db.query("update vehicles set publication='published' where id=$1",[id]);
 assert.equal((await commit(plan('DEMO88','different'))).status,'existing');
 const normal=plan('DEMO01');assert.equal((await commit(normal)).status,'existing');
 const aliasA=await draft('ALIAS1'),aliasB=await draft('ALIAS2'),ambiguous=plan('ALIAS1');ambiguous.plate_aliases=['ALIAS1','ALIAS2'];
 await assert.rejects(()=>commit(ambiguous),/Multiple stock records/);assert.equal((await row(aliasA)).brand,null);assert.equal((await row(aliasB)).brand,null);
 await as('authenticated');await assert.rejects(()=>db.query('select public.e2_import_drive_vehicle($1,$2,$3,$4,$5)',[ids.admin,'folder_DENIED1','stamp','source',plan('DENIED1')]),/permission denied/);
 console.log('Plate drafts passed: only plate required, private/role guards, publication completeness, real worker + SQL enrichment, same Runner job linkage, no overwrite, retries, invalid-photo rollback, existing-photo/published exclusions and ambiguous alias rejection.');
}finally{await db.close();}
