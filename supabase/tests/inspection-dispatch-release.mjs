import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {operationsDatabase} from '../../tests/fixtures/operations-db.mjs';
const {db,ids,as,rpc,scalar}=await operationsDatabase();
try{
 // Include existing legacy records, including cancelled history, before upgrading.
 await db.query("update e2_vehicle_inspections set status='Repair required',findings='Repair pending' where id=$1",[ids.inspection]);
 const cancelled=randomUUID();await db.query("insert into e2_vehicle_inspections(id,vehicle_id,assigned_to,created_by,status,closed_at,completion_notes) values($1,$2,$3,$3,'Cancelled',now(),'Old cancellation')",[cancelled,ids.car2,ids.inspector]);
 for(const f of ['202609180001_drive_photos','202609210001_vehicle_import','202609210003_plate_only_import','202610010001_vehicle_translation','202610210004_plate_drafts','202610210005_enrich_plate_drafts','202610220001_vehicle_recycle','202610220002_inspection_statuses','202610220003_account_dispatch'])await db.exec(await readFile('supabase/migrations/'+f+'.sql','utf8'));
 await as('inspector');
 const workspace=await scalar('select e2_inspection_workspace()');
 assert.equal(workspace.jobs.find(j=>j.id===ids.inspection).status,'In repair');
 assert.equal(workspace.jobs.find(j=>j.id===cancelled).status,'Cancelled');
 assert.equal(await scalar("select snapshot->>'status' from e2_vehicle_inspection_events where inspection_id=$1 and action='Status consolidation: previous record'",[ids.inspection]),'Repair required');
 assert.equal(workspace.vehicles.find(v=>v.id===ids.car2).lifecycle_state,'active');
 let inspection=await scalar('select to_jsonb(e2_start_inspection($1,$2,$3))',[randomUUID(),ids.car2,ids.inspector]);
 assert.equal(inspection.status,'Pending inspection');
 const changes={assigned_to:ids.inspector,status:'In repair',checklist:inspection.checklist,findings:'Needs cushion repair',workshop:'',repair_date:null,repair_time:null,repair_notes:'',completion_notes:''};
 const save=delta=>scalar('select to_jsonb(e2_save_inspection($1,$2,$3))',[inspection.id,inspection.revision,{...changes,...delta}]);
 for(const status of ['Inspecting','Repair required','Repair booked','Cancelled'])await assert.rejects(()=>save({status}),/Choose an inspection status/);
 inspection=await save({});assert.equal(inspection.status,'In repair');
 await assert.rejects(()=>save({status:'Ready'}),/Resolve checklist/);
 inspection=await save({status:'Ready',checklist:Object.fromEntries(Object.keys(inspection.checklist).map(k=>[k,'pass'])),completion_notes:'Final check completed'});assert.equal(inspection.status,'Ready');
 await assert.rejects(()=>save({status:'Pending inspection'}),/Closed inspections/);
 await as('account');const w=await rpc('e2_operations_workspace');assert(w.vehicles.length===2);assert(w.runners.length===2);
 let job=await rpc('e2_save_runner_job',{request_id:randomUUID(),details:{vehicle_id:ids.car2,assigned_to:ids.runner,kind:'carro_pickup',origin:'DEMO Carro',destination:'DEMO E2'}});
 assert.equal(job.created_by,ids.account);assert((await rpc('e2_operations_workspace')).jobs.some(j=>j.id===job.id));
 job=await rpc('e2_save_runner_job',{request_id:job.id,expected_revision:job.revision,details:{vehicle_id:ids.car2,assigned_to:ids.runner,kind:'carro_pickup',origin:'DEMO Carro B',destination:'DEMO E2'}});
 assert.equal(job.origin,'DEMO Carro B');
 await assert.rejects(()=>rpc('e2_accept_runner_job',{target:job.id,expected_revision:job.revision}),/assigned|Runner|available/);
 await assert.rejects(()=>rpc('e2_move_runner_job',{target:job.id,expected_revision:job.revision,next_status:'cancelled',note:'No permission'}),/available/);
 await assert.rejects(()=>db.query("insert into vehicles(plate,import_pending) values('NOACCOUNT',true)"),/row-level|permission/);
 await as('runner2');assert(!(await rpc('e2_operations_workspace')).jobs.some(j=>j.id===job.id));
 await as('runner');await rpc('e2_accept_runner_job',{target:job.id,expected_revision:job.revision});
 await as('sales');await assert.rejects(()=>rpc('e2_save_runner_job',{request_id:randomUUID(),details:{}}),/Admin or Account/);
 await as('inactive');await assert.rejects(()=>rpc('e2_save_runner_job',{request_id:randomUUID(),details:{}}),/Admin or Account/);
 // Approval remains unavailable to Account, including SQL calls bypassing the UI.
 await as('inspector');const claim=await rpc('e2_save_ops_claim',{request_id:randomUUID(),details:{kind:'repair',inspection_id:ids.inspection,supplier:'DEMO',expense_date:'2026-10-22',amount:10,description:'Fixture'}});
 await db.exec('reset role');await db.query("update e2_ops_claims set status='submitted' where id=$1",[claim.id]);
 await as('account');await assert.rejects(()=>rpc('e2_action_ops_claim',{target:claim.id,expected_revision:claim.revision,action:'approve'}),/unavailable|not allowed/);
 console.log('PASS: three inspection choices, pending default, legacy history, final checks, Account dispatch/reassign, Runner isolation and unchanged approval/movement restrictions.');
}finally{await db.close();}
