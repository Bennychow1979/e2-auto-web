import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {validateTranslation,translateDescription} from '../functions/e2-translate-vehicle/core.mjs';
import {translationHandler} from '../functions/e2-translate-vehicle/handler.mjs';
import {currentTranslation,loadVehicleDescription} from '../../vehicle-description.mjs';
import {translationStatus} from '../../vehicle-translation-ui.mjs';

const source='2019 Mazda CX-5 2.5\nRM71,990';
const output={source_language:'en',en:source,ms:'2019 Mazda CX-5 2.5\nRM71,990',zh:'2019 Mazda CX-5 2.5\nRM71,990'};
assert.equal(validateTranslation({...output,en:'rewritten'},source).en,source);
for(const zh of ['2019 Mazda CX-5 2.5\nRM70,000',source+' 3 年保修','',null])assert.throws(()=>validateTranslation({...output,zh},source));
await assert.rejects(translateDescription(source,{}),/configuration_required/);
let providerCalls=0;
const provider=async(url,options)=>{
  providerCalls++;
  assert.equal(url,'https://api.openai.com/v1/responses');
  const body=JSON.parse(options.body);
  assert.equal(body.store,false);assert.equal(body.text.format.strict,true);
  assert.equal(JSON.parse(body.input[0].content).listing,source);
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(output)}]}]});
};
assert.deepEqual(await translateDescription(source,{apiKey:'test-only-placeholder',request:provider}),output);
for(const [status,code,expected] of [[401,'invalid_api_key','configuration_required'],[429,'insufficient_quota','billing_required'],[429,'rate_limit_exceeded','rate_limited']]) {
  await assert.rejects(translateDescription(source,{apiKey:'test-only-placeholder',request:async()=>Response.json({error:{code}},{status})}),new RegExp(expected));
}
await assert.rejects(translateDescription(source,{apiKey:'test-only-placeholder',request:async()=>Response.json({status:'incomplete',output:[]})}),/invalid_output/);
await assert.rejects(translateDescription(source,{apiKey:'test-only-placeholder',request:async()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'refusal'}]}]})}),/refused/);
const carId='10000000-0000-4000-8000-000000000001',hash='a'.repeat(64),token='e2tr_'+'b'.repeat(64);
let claims=0,finished;
const handler=translationHandler({apiKey:'test-only-placeholder',request:provider,store:{claim:async()=>{claims++;return {source_text:source};},finish:async args=>{finished=args;return true;}}});
const request=(authorization='Bearer '+token,body={vehicle_id:carId,source_hash:hash},origin)=>new Request('https://example.test/function',{method:'POST',headers:{Authorization:authorization,...(origin?{Origin:origin}:{})},body:JSON.stringify(body)});
assert.equal((await handler(request('Bearer visitor'))).status,401);
assert.equal((await handler(request(undefined,undefined,'https://e2auto.my'))).status,403);
assert.equal(claims,0);
const response=await handler(request());assert.equal(response.status,200);assert.equal(finished.output.en,source);
const receipt=await response.text();assert(!receipt.includes(source)&&!receipt.includes(token));
const staleHandler=translationHandler({apiKey:'test-only-placeholder',request:()=>{throw Error('Must not call provider');},store:{claim:async()=>null}});
assert.equal((await staleHandler(request())).status,409);
const noKey=translationHandler({store:{claim:async()=>({source_text:source}),finish:async args=>{finished=args;return true;}}});
await noKey(request());assert.equal(finished.failure,'configuration_required');
assert.equal(currentTranslation({description:source},'zh',{source_text:'old copy',zh:'old translation'}),null);
assert.equal(currentTranslation({description:source},'zh',{source_text:source,zh:output.zh}),output.zh);
const missingDb={from(){return {select(){return this;},eq(){return this;},maybeSingle:async()=>({error:{code:'PGRST205'}})};}};
assert.equal(await loadVehicleDescription(missingDb,{id:carId,description:source},'zh'),source);
assert.match(translationStatus({status:'failed',error_code:'billing_required'}),/paused/);
assert.match(translationStatus({status:'ready'}),/ready/);

const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create schema storage;create schema net;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));
alter table storage.objects enable row level security;
grant usage on schema public,auth,storage to anon,authenticated,service_role;
grant select,insert,update,delete on storage.objects to anon,authenticated;
grant execute on function auth.uid() to anon,authenticated;
create table net.requests(id bigint generated always as identity,url text,headers jsonb,body jsonb);
create function net.http_post(url text,body jsonb default '{}'::jsonb,params jsonb default '{}'::jsonb,headers jsonb default '{}'::jsonb,timeout_milliseconds integer default 1000) returns bigint language sql as $$insert into net.requests(url,headers,body) values(url,headers,body) returning id$$;`);
for(const file of ['202609120001_inventory.sql','202609170013_optional_vehicle_spec.sql','202610010001_vehicle_translation.sql'])await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
const admin='00000000-0000-4000-8000-000000000001',sales='00000000-0000-4000-8000-000000000002';
await db.exec(`insert into auth.users(id) values('${admin}'),('${sales}');insert into public.staff_memberships(user_id,role) values('${admin}','admin'),('${sales}','sales');`);
async function as(role,id=''){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);if(role)await db.exec('set role '+role);}
async function mustFail(sql){await assert.rejects(db.exec(sql));}
async function row(sql,params=[]){return (await db.query(sql,params)).rows[0];}
const count=async table=>Number((await row('select count(*) n from '+table)).n);
async function job(){return row('select * from public.vehicle_translation_jobs where vehicle_id=$1',[carId]);}
async function capability(){const r=await row('select * from net.requests order by id desc limit 1');assert(!JSON.stringify(r.body).includes(source));return {...r.body,token:r.headers.Authorization.slice(7)};}
async function claim(c){await as('service_role');return (await row('select public.e2_claim_vehicle_translation($1,$2,$3) value',[carId,c.source_hash,c.token])).value;}
async function finish(c,body=output,failure=null){await as('service_role');return (await row('select public.e2_finish_vehicle_translation($1,$2,$3,$4::jsonb,$5) value',[carId,c.source_hash,c.token,JSON.stringify(body),failure])).value;}
await as('authenticated',admin);
await db.query("insert into public.vehicles(id,plate,brand,model,year,engine_litres,transmission,fuel_type,price,description) values($1,'TESTAUTO','Mazda','CX-5',2019,2.5,'Auto','PETROL',71990,$2)",[carId,source]);
await as();assert.equal((await job()).error_code,'setup_required');assert.equal(await count('net.requests'),0);
await db.exec('update public.vehicle_translation_settings set enabled=true');
await db.exec('select public.e2_retry_pending_vehicle_translations()');
let c=await capability();assert.equal((await job()).attempts,1);
await as('anon');await mustFail('select * from public.vehicle_translation_jobs');await mustFail(`select public.e2_claim_vehicle_translation('${carId}','${hash}','${token}')`);
await as('authenticated',admin);await mustFail('select token_hash from public.vehicle_translation_jobs');
await mustFail(`select public.e2_dispatch_vehicle_translation('${carId}')`);
await as('authenticated',sales);assert.equal((await db.query('select vehicle_id,status from public.vehicle_translation_jobs')).rows.length,0);
await as('service_role');assert.equal((await row('select public.e2_claim_vehicle_translation($1,$2,$3) value',[carId,c.source_hash,token])).value,null);
assert.equal(await claim({...c,source_hash:null}),null);
assert.equal((await claim(c)).source_text,source);assert.equal(await claim(c),null,'Duplicate dispatch cannot incur another API call');
await as();const before=await row('select description,price,updated_at from public.vehicles where id=$1',[carId]);
assert.equal(await finish(c),true);assert.equal(await finish(c),false);
await as();assert.deepEqual(await row('select description,price,updated_at from public.vehicles where id=$1',[carId]),before);
await as('anon');assert.equal(await count('public.vehicle_description_translations'),0,'Draft translations are private');
await as('authenticated',admin);
const photo='20000000-0000-4000-8000-000000000001',path=carId+'/'+photo+'.webp';
await db.exec(`insert into storage.objects(bucket_id,name) values('vehicle-photos','${path}');insert into public.vehicle_photos(id,vehicle_id,path,position) values('${photo}','${carId}','${path}',0);update public.vehicles set publication='published' where id='${carId}';`);
await as('anon');assert.equal(await count('public.vehicle_description_translations'),1);
await mustFail(`update public.vehicle_description_translations set zh='tampered' where vehicle_id='${carId}'`);
await as('authenticated',admin);await db.exec(`update public.vehicles set publication='draft' where id='${carId}'`);
await as('anon');assert.equal(await count('public.vehicle_description_translations'),0);
await as('authenticated',admin);await db.exec(`update public.vehicles set price=72000,description=description where id='${carId}'`);
await as();assert.equal(await count('net.requests'),1,'Non-description saves do not translate again');
await as('authenticated',admin);await db.query('update public.vehicles set description=$1 where id=$2',[source+'\nNew',carId]);
await as();assert.equal(await count('public.vehicle_description_translations'),0,'Edit invalidates previous translations immediately');
c=await capability();assert(await claim(c));
await as('authenticated',admin);await db.query('update public.vehicles set description=$1 where id=$2',[source+'\nNewest',carId]);
assert.equal(await finish(c),false,'An in-flight old translation cannot overwrite a newer description');
await as();c=await capability();assert(await claim(c));
assert.equal(await finish(c,null,'rate_limited'),true);
await as();assert.equal((await job()).status,'pending');assert.equal(await count('public.vehicle_description_translations'),0);
await db.exec("update public.vehicle_translation_jobs set next_attempt_at=now()-interval '1 minute'");await db.exec('select public.e2_retry_pending_vehicle_translations()');
c=await capability();assert(await claim(c));await finish(c,null,'configuration_required');
await as();assert.equal((await job()).status,'failed');
const calls=await count('net.requests');await db.exec('select public.e2_retry_pending_vehicle_translations()');assert.equal(await count('net.requests'),calls,'Missing configuration does not loop paid retries');
await as('authenticated',sales);await mustFail(`select public.e2_retry_vehicle_translation('${carId}')`);
await as('authenticated',admin);await mustFail(`select public.e2_retry_vehicle_translation('${carId}')`);
await as();await db.exec("update public.vehicle_translation_jobs set updated_at=now()-interval '2 minutes'");
await as('authenticated',admin);await db.exec(`select public.e2_retry_vehicle_translation('${carId}')`);
await as();assert.equal((await job()).attempts,1);
for(let i=0;i<3;i++){await db.exec("update public.vehicle_translation_jobs set lease_until=now()-interval '1 minute'");await db.exec('select public.e2_retry_pending_vehicle_translations()');}
assert.equal((await job()).status,'failed');assert.equal((await job()).attempts,3,'Retry count is bounded');
await as('authenticated',admin);await db.exec(`update public.vehicles set description='' where id='${carId}'`);
await as();assert.equal((await job()).status,'empty');const emptyCalls=await count('net.requests');await db.exec('select public.e2_retry_pending_vehicle_translations()');assert.equal(await count('net.requests'),emptyCalls);
await db.exec("create or replace function net.http_post(url text,body jsonb default '{}'::jsonb,params jsonb default '{}'::jsonb,headers jsonb default '{}'::jsonb,timeout_milliseconds integer default 1000) returns bigint language plpgsql as $$begin raise exception 'Network unavailable';end$$");
await as('authenticated',admin);await db.query('update public.vehicles set description=$1 where id=$2',[source,carId]);
await as();assert.equal((await job()).error_code,'dispatch_failed');assert.equal((await row('select description from public.vehicles where id=$1',[carId])).description,source,'Dispatch failure does not lose a save');
await db.close();
console.log('Automatic translation checks passed: provider validation, original preservation, missing-key behavior, authorization, RLS, one-use dispatch, stale-result rejection, bounded retries, save safety and public fallback.');
