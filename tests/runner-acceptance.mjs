import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {operationsDatabase} from './fixtures/operations-db.mjs';
import {notificationPreview} from './fixtures/runner-notifications-preview.mjs';
const {db,ids,as,rpc,scalar}=await operationsDatabase();
let checks=0;
const check=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);checks++;};
const rejects=async(fn)=>{await assert.rejects(fn);checks++;};
try{
 const details={vehicle_id:ids.car,assigned_to:ids.runner,kind:'send_invoice',origin:'DEMO Office',destination:'DEMO Workshop'};
 await as('admin');let job=await rpc('e2_save_runner_job',{request_id:randomUUID(),details});
 const accept=()=>rpc('e2_accept_runner_job',{target:job.id,expected_revision:job.revision});
 for(const role of ['admin','account','inspector','runner2','inactive','anon']){await as(role);await rejects(accept);}
 await as('runner');await rejects(()=>rpc('e2_accept_runner_job',{target:job.id,expected_revision:null}));
 const oldRevision=job.revision;job=await accept();check(!!job.accepted_at,true,'Acceptance saved');
 const duplicate=await rpc('e2_accept_runner_job',{target:job.id,expected_revision:oldRevision});check(duplicate.revision,job.revision,'Retry is idempotent');
 check(await scalar("select count(*)::int from public.e2_ops_events where action='Runner accepted'"),1,'Only one acceptance audit');
 await as('admin');job=await rpc('e2_save_runner_job',{request_id:job.id,expected_revision:job.revision,details:{...details,assigned_to:ids.runner2}});
 check(job.accepted_at,null,'Reassignment resets acceptance');check(job.dispatch_version,2,'Version advances');
 await as('runner');await rejects(accept);
 await as('runner2');await rejects(()=>rpc('e2_accept_runner_job',{target:job.id,expected_revision:oldRevision}));
 job=await accept();check(!!job.accepted_at,true,'New Runner can accept');
 await as('admin');job=await rpc('e2_save_runner_job',{request_id:job.id,expected_revision:job.revision,details:{...details,assigned_to:ids.runner2,destination:'DEMO New destination'}});
 check(job.accepted_at,null,'Edited details need confirmation again');
 job=await rpc('e2_move_runner_job',{target:job.id,expected_revision:job.revision,next_status:'cancelled',note:'TEST cancelled'});
 await as('runner2');await rejects(accept);

 let now=100000;
 const mock=notificationPreview({now:()=>now});
 const row={...job,status:'assigned',accepted_at:null,dispatch_version:1,assigned_to:ids.runner,runner_name:'DEMO Runner',plate:'DEMO01'};
 mock.sync([row]);mock.sync([row]);check(mock.view('super_admin',ids.admin).messages.length,1,'No duplicate dispatch notification');
 check(mock.view('runner',ids.runner2).messages.length,0,'Other Runner sees no notification');
 check(mock.view('inspector',ids.inspector).messages.length,0,'Inspector sees no notification');
 now+=899999;check(mock.view('super_admin',ids.admin).messages.length,1,'No reminder before 15 minutes');
 now+=1;check(mock.view('super_admin',ids.admin).messages.filter(m=>m.kind==='overdue').length,1,'Reminder at 15 minutes');
 now+=900000;check(mock.view('super_admin',ids.admin).messages.length,2,'Only one reminder per dispatch');
 mock.sync([{...row,accepted_at:new Date(now).toISOString()}]);check(mock.view('super_admin',ids.admin).messages.filter(m=>m.kind==='overdue'&&!m.resolved).length,0,'Acceptance clears active reminder');
 mock.sync([{...row,dispatch_version:2,assigned_to:ids.runner2}]);check(mock.view('runner',ids.runner).messages.length,0,'Reassignment hides old notification from former Runner');
 check(mock.view('super_admin',ids.admin).messages.filter(m=>m.kind==='overdue'&&!m.resolved).length,0,'Reassignment restarts timer');
 mock.advance();check(mock.view('super_admin',ids.admin).messages.filter(m=>m.kind==='overdue'&&!m.resolved).length,1,'New Runner has independent timeout');
 mock.sync([{...row,dispatch_version:2,assigned_to:ids.runner2,status:'cancelled'}]);check(mock.view('super_admin',ids.admin).messages.filter(m=>m.kind==='overdue'&&!m.resolved).length,0,'Cancellation clears reminder');
 console.log(`${checks} acceptance and simulated notification checks passed.`);
}finally{await db.close();}
