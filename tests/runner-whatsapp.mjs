import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {operationsDatabase} from './fixtures/operations-db.mjs';
import {runnerMessage,jobLink,whatsappURL} from '../runner-message.mjs';
import {normalizeWhatsApp} from '../profile-utils.js';
const {db,ids,as,rpc,scalar}=await operationsDatabase();
try{
 await db.exec(await readFile('supabase/migrations/202610220004_runner_whatsapp.sql','utf8'));
 await as('admin');
 const j=await rpc('e2_save_runner_job',{request_id:randomUUID(),details:{vehicle_id:ids.car,assigned_to:ids.runner,kind:'carro_pickup',origin:'Carro & Co',destination:'E2 店'}});
 const prepare=(rev=j.revision)=>scalar('select public.e2_prepare_runner_whatsapp($1,$2)',[j.id,rev]);
 assert.equal((await prepare()).phone,null);
 await scalar('select public.e2_verify_runner_whatsapp($1,$2)',[ids.runner,'60100000000']);
 const prepared=await prepare();assert(prepared.verified_at);assert.equal(prepared.phone,'60100000000');
 const verifyJob=(revision=j.revision,confirmed=true,prior=prepared.verified_at,phone='60100000000')=>scalar('select public.e2_verify_job_runner_whatsapp($1,$2,$3,$4,$5)',[j.id,revision,phone,confirmed,prior]);
 assert.equal(normalizeWhatsApp('010-000 0001'),'60100000001');assert.equal(normalizeWhatsApp('+60 10-000 0001'),'60100000001');
 await assert.rejects(()=>verifyJob(j.revision,false));await assert.rejects(()=>verifyJob(j.revision,true,null),'Stale contact rejected');
 await assert.rejects(()=>verifyJob(j.revision+1));await assert.rejects(()=>verifyJob(j.revision,true,prepared.verified_at,'invalid'));
 const saved=await verifyJob();assert.equal(saved.phone,'60100000000');assert(saved.verified_at);
 const message=runnerMessage(prepared.job),url=new URL(whatsappURL(prepared.phone,message));
 assert(message.includes('DEMO01'));assert(message.includes('Carro 取车'));assert(message.includes('Carro & Co'));assert(message.includes('E2 店'));
 assert.equal(url.searchParams.get('text'),message);assert.equal(new URL(jobLink(j.id)).searchParams.get('job'),j.id);assert(!message.includes('previewRole'));
 assert.throws(()=>whatsappURL('javascript:alert(1)',message));assert.throws(()=>jobLink('../admin'));
 for(const role of ['admin','account']){await as(role);assert.equal((await prepare()).phone,'60100000000');}
 for(const role of ['runner','runner2','inspector','sales','inactive','anonymous']){await as(role);await assert.rejects(prepare);await assert.rejects(verifyJob);await assert.rejects(()=>scalar('select public.e2_verify_runner_whatsapp($1,$2)',[ids.runner,'60100000001']));}
 await as('account');await assert.rejects(()=>scalar('select public.e2_verify_runner_whatsapp($1,$2)',[ids.runner,'60100000001']));await assert.rejects(()=>db.query('select * from public.e2_runner_notification_contacts'));
 await assert.rejects(verifyJob);
 await as('admin');await assert.rejects(()=>prepare(j.revision+1));
 let updated=await rpc('e2_save_runner_job',{request_id:j.id,expected_revision:j.revision,details:{vehicle_id:j.vehicle_id,kind:j.kind,origin:j.origin,destination:j.destination,assigned_to:ids.runner2}});
 await assert.rejects(prepare);assert.equal((await prepare(updated.revision)).phone,null,'Reassignment must use new Runner contact');
 await assert.rejects(verifyJob,'Old dialog cannot verify after reassignment');
 await as('runner2');updated=await rpc('e2_accept_runner_job',{target:j.id,expected_revision:updated.revision});
 await as('admin');await assert.rejects(()=>prepare(updated.revision),'Accepted jobs cannot be sent as new requests');
 console.log('WhatsApp content, verified recipient, role isolation, stale revision and accepted/reassigned job checks passed.');
}finally{await db.close();}
