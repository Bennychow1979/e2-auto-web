import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHandler} from '../functions/e2-inventory-refresh/handler.mjs';
import {fetchPublicInventory,buildVehicleSite} from '../../scripts/build-vehicle-pages.mjs';
const id='aaaaaaaa-1111-4111-8111-111111111111';
test('transactional inventory outbox, permissions, coalescing, retry, receipt and zero-public withdrawal',async t=>{
 const db=new PGlite();
 try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create table public.vehicles(id uuid primary key,publication text,price numeric,stock_status text);
   create table public.vehicle_photos(id uuid primary key,vehicle_id uuid references public.vehicles(id) on delete cascade);
   create schema net;create table net.test_requests(url text,headers jsonb,body jsonb);
   create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) returns bigint language plpgsql as $$begin insert into net.test_requests values(url,headers,body);return 1;end;$$;
   grant usage on schema public to anon,authenticated,service_role;`);
  await db.exec(await readFile(new URL('../migrations/202610310001_inventory_refresh.sql',import.meta.url),'utf8'));
  const state=async()=>(await db.query('select * from e2_inventory_refresh')).rows[0];
  const claim=async()=>(await db.query('select e2_claim_inventory_refresh() job')).rows[0].job;
  const finish=async(job,outcome)=>(await db.query('select e2_finish_inventory_refresh($1,$2,$3) ok',[job.lease,job.dispatch,outcome])).rows[0].ok;
  const due=()=>db.exec("update e2_inventory_refresh set available_at=now()-interval '1 second',first_dirty_at=now()-interval '1 minute',lease_until=null");
  await t.test('disabled by default; draft-only changes do not enqueue; public transitions, prices, statuses, photos and deletes do',async()=>{
   assert.equal((await state()).enabled,false);assert.equal(await claim(),null);
   await db.query("insert into vehicles values($1,'draft',1,'Available')",[id]);assert.equal(Number((await state()).revision),1);
   await db.query("update vehicles set publication='published' where id=$1",[id]);assert.equal(Number((await state()).revision),2);
   await db.query("update vehicles set price=2,stock_status='Reserved' where id=$1",[id]);assert.equal(Number((await state()).revision),3);
   await db.query('insert into vehicle_photos values($1,$1)',[id]);assert.equal(Number((await state()).revision),4);
   await db.query('delete from vehicle_photos where id=$1',[id]);assert.equal(Number((await state()).revision),5);
   await db.exec("begin;update vehicles set publication='draft';rollback;");assert.equal(Number((await state()).revision),5);
   await db.exec("update vehicles set publication='draft'");assert.equal(Number((await state()).revision),6);
   await db.exec('delete from vehicles');assert.equal(Number((await state()).revision),6);
   await db.query("insert into vehicles values($1,'published',3,'Sold')",[id]);await db.exec('delete from vehicles');assert.equal(Number((await state()).revision),8);
  });
  await t.test('anonymous/staff cannot read queue, invoke worker or forge acknowledgements',async()=>{
   for(const role of ['anon','authenticated']){
    await db.exec('set role '+role);
    await assert.rejects(db.query('select * from e2_inventory_refresh'),/permission denied/);
    await assert.rejects(db.query('select e2_claim_inventory_refresh()'),/permission denied/);
    await assert.rejects(db.query('select e2_dispatch_inventory_refresh()'),/permission denied/);
    await assert.rejects(db.query('select e2_finish_inventory_refresh($1,$1,$2)',[id,'deployed']),/permission denied/);
    await db.exec('reset role');
   }
   await db.exec('set role service_role');assert.equal(await claim(),null);
   await assert.rejects(db.query('select e2_dispatch_inventory_refresh()'),/permission denied/);await db.exec('reset role');
  });
  await t.test('one-use capabilities, duplicate ticks and bounded debounce',async()=>{
   await db.exec("update e2_inventory_refresh set enabled=true,first_dirty_at=now(),available_at=now()");
   assert.equal(await claim(),null);
   await db.exec('select e2_dispatch_inventory_refresh();select e2_dispatch_inventory_refresh();');
   const queued=(await db.query('select * from net.test_requests')).rows;assert.equal(queued.length,1);
   const body=queued[0].body,token=queued[0].headers.Authorization.slice(7);
   assert.equal((await db.query('select e2_claim_inventory_refresh_dispatch($1,$2) ok',[body.dispatch_id,token])).rows[0].ok,true);
   assert.equal((await db.query('select e2_claim_inventory_refresh_dispatch($1,$2) ok',[body.dispatch_id,token])).rows[0].ok,false);
   await db.query("update e2_inventory_refresh_dispatches set claimed_at=null,expires_at=now()-interval '1 second' where id=$1",[body.dispatch_id]);
   assert.equal((await db.query('select e2_claim_inventory_refresh_dispatch($1,$2) ok',[body.dispatch_id,token])).rows[0].ok,false);
   await due();const job=await claim();assert.equal(job.action,'dispatch');assert.equal(job.revision,'8');assert.equal(await claim(),null);
   assert.equal(await finish({...job,lease:id},'deployed'),false);assert(await finish(job,'dispatched'));
  });
  await t.test('updates during a build remain dirty; only exact active receipt acknowledges that generation',async()=>{
   await db.query("insert into vehicles values($1,'published',4,'Available')",[id]);
   await due();const check=await claim();assert.equal(check.action,'check');assert.equal(check.revision,'8');
   assert(await finish(check,'deployed'));const s=await state();assert.equal(Number(s.deployed_revision),8);assert.equal(Number(s.revision),9);assert(s.first_dirty_at);
   const next=await claim();assert.equal(next.action,'dispatch');assert.equal(next.revision,'9');assert.notEqual(next.dispatch,check.dispatch);
   assert.equal(await finish(check,'deployed'),false);assert(await finish(next,'uncertain'));
   await due();const ambiguous=await claim();assert.equal(ambiguous.action,'check');assert.equal(ambiguous.dispatch,next.dispatch);assert(await finish(ambiguous,'waiting'));
  });
  await t.test('timeout and known rejection back off; no lost dirty event; success clears it',async()=>{
   await due();await db.exec("update e2_inventory_refresh set dispatched_at=now()-interval '31 minutes'");
   assert.equal(await claim(),null);assert.equal((await state()).last_issue,'publication_timeout');assert.equal(await claim(),null);
   await due();const retry=await claim();assert.equal(retry.action,'dispatch');assert(await finish(retry,'rejected'));assert.equal(await claim(),null);
   await due();const retry2=await claim();assert(await finish(retry2,'deployed'));const s=await state();assert.equal(Number(s.deployed_revision),9);assert.equal(s.first_dirty_at,null);assert.equal(await claim(),null);
   assert.equal((await db.query("select e2_finish_inventory_refresh(null,null,'deployed') ok")).rows[0].ok,false);
  });
  await t.test('all vehicles withdrawn triggers a new generation and daily reconcile is only backup',async()=>{
   await db.exec("update vehicles set publication='draft'");await due();const zero=await claim();assert.equal(zero.revision,'10');assert(await finish(zero,'deployed'));
   await db.exec("update e2_inventory_refresh set last_deployed_at=now()-interval '25 hours'");await db.exec('select e2_dispatch_inventory_refresh()');assert.equal(Number((await state()).revision),11);
  });
  await t.test('expired worker leases cannot acknowledge a build',async()=>{
   await due();const pending=await claim();assert(pending);
   await db.exec("update e2_inventory_refresh set lease_until=now()-interval '1 second'");
   assert.equal(await finish(pending,'deployed'),false);
  });
  await t.test('committed withdrawal reaches a complete zero artifact and only its live hashes acknowledge the SQL revision',async()=>{
   await db.exec("update e2_inventory_refresh set dispatch_id=null,dispatch_revision=null,dispatched_at=null,lease_id=null,lease_until=null");await due();
   let inputs;const store={
    claimDispatch:async(dispatch,token)=>(await db.query('select e2_claim_inventory_refresh_dispatch($1,$2) ok',[dispatch,token])).rows[0].ok,
    claim,
    finish:async(job,outcome,retry)=>(await db.query('select e2_finish_inventory_refresh($1,$2,$3,$4) ok',[job.lease,job.dispatch,outcome,retry])).rows[0].ok
   };
   const invocation=async()=>{
    await db.exec('select e2_dispatch_inventory_refresh()');
    const req=(await db.query('select * from net.test_requests')).rows.at(-1);
    return new Request('https://worker.test/',{method:'POST',headers:req.headers,body:JSON.stringify(req.body)});
   };
   const dispatch=createHandler({store,githubToken:'synthetic',fetchImpl:async(url,options)=>{inputs=JSON.parse(options.body).inputs;return new Response(null,{status:204});}});
   assert.equal((await dispatch(await invocation())).status,200);assert(inputs.inventory_dispatch);
   const snapshot=await fetchPublicInventory({supabaseUrl:'https://synthetic.supabase.co',publishableKey:'sb_publishable_synthetic'},async()=>new Response('[]',{headers:{'content-range':'*/0'}}));
   Object.assign(snapshot,{publicPhotos:[],publicImageOrigin:'https://synthetic.supabase.co',inventoryRefresh:{revision:inputs.inventory_revision,dispatch:inputs.inventory_dispatch}});
   const out=join(await mkdtemp(join(tmpdir(),'e2-refresh-flow-')),'site');await buildVehicleSite(snapshot,out,{release:true});
   const check=createHandler({store,fetchImpl:async url=>new Response(await readFile(join(out,new URL(url).pathname.slice(1)),'utf8'))});
   await due();const result=await check(await invocation());assert.equal(result.status,200);assert.equal((await result.json()).outcome,'deployed');
   const s=await state();assert.equal(String(s.deployed_revision),inputs.inventory_revision);assert.equal(s.dispatch_id,null);assert.equal(s.first_dirty_at,null);
  });
 }finally{await db.close();}
});
