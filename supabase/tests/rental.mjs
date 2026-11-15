import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to anon,authenticated,service_role;
 create table public.staff_memberships(user_id uuid primary key,role text,active boolean default true);
 alter table public.staff_memberships enable row level security;
 grant select on public.staff_memberships to authenticated;
 create policy own on public.staff_memberships for select to authenticated using(user_id=auth.uid());
 create function public.e2_is_super_admin() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.staff_memberships where user_id=auth.uid() and role='super_admin' and active)$$;
 revoke all on function public.e2_is_super_admin() from public;grant execute on function public.e2_is_super_admin() to authenticated;`);
const ids={};let i=1;for(const role of ['super_admin','admin','office_admin','sales','runner','account','customer','inactive']){
 const id='00000000-0000-4000-8000-'+String(i++).padStart(12,'0');ids[role]=id;
 await db.query('insert into auth.users values($1,$2)',[id,role+'@example.test']);
 await db.query('insert into staff_memberships values($1,$2,$3)',[id,role==='inactive'?'admin':role,role!=='inactive']);
}
await db.exec(await readFile(new URL('../migrations/20261115175606_rental_staff_tracker.sql',import.meta.url),'utf8'));
const as=async role=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[role]||'']);await db.exec('set role '+(role==='anon'?'anon':'authenticated'));};
const q=async(sql,args=[])=> (await db.query(sql,args)).rows;
const can=async()=> (await q('select public.rental_ok() value'))[0].value;
const grant=(role,enabled,revision)=>q('select public.rental_set_access($1,$2,$3)',[ids[role],enabled,revision]);
const save=(kind,id,data,revision,merge=false)=>q('select public.rental_save($1,$2,$3,$4,$5) result',[kind,id,data,revision,merge]);
for(const role of ['anon','admin','office_admin','sales','runner','account','customer','inactive']){
 await as(role);if(role==='anon')await assert.rejects(can);else assert.equal(await can(),false,role);
 for(const table of ['rental_contracts','rental_settings','rental_contracts_flat','rental_audit']){
  if(role==='anon')await assert.rejects(()=>q('select * from '+table));else assert.equal((await q('select * from '+table)).length,0,role+' '+table);
 }
 await assert.rejects(()=>grant('admin',true,0));await assert.rejects(()=>save('contracts','DEMO1',{plate:'DEMO1',payments:[]},0));
}
await as('super_admin');assert.equal(await can(),true);assert.equal((await q('select * from rental_list_access()')).length,3);
await assert.rejects(()=>grant('sales',true,0));await assert.rejects(()=>grant('inactive',true,0));
await grant('admin',true,0);await grant('office_admin',true,0);await assert.rejects(()=>grant('admin',false,0));
await as('admin');assert.equal(await can(),true);
await save('contracts','DEMO1',{plate:'DEMO1',first_payment_date:'2026-08-12',payments:[],handovers:[],monthly:500},0);
assert.equal((await q('select first_payment_date::text d from rental_contracts'))[0].d,'2026-08-12');
await assert.rejects(()=>q("update rental_contracts set data='{}'"));await assert.rejects(()=>q('delete from rental_contracts'));await assert.rejects(()=>q('update rental_access set enabled=true'));
await assert.rejects(()=>save('contracts','DEMO1',{payments:[{amount:500}]},0,true));
await save('contracts','DEMO1',{payments:[{amount:500}]},1,true);
await as('office_admin');assert.equal(await can(),true);assert.equal((await q('select * from rental_contracts')).length,1);
await assert.rejects(()=>save('contracts','DEMO1',{payments:[{amount:600}]},1,true));
assert.deepEqual((await q('select data from rental_contracts'))[0].data.payments,[{amount:500}]);
await save('settings','lists',{agents:['DEMO'],financiers:[],partners:[]},1);
await assert.rejects(()=>save('contracts','DEMO1',{plate:'CHANGED'},2,true));
await assert.rejects(()=>save('contracts','DEMO2',{plate:'DEMO2',first_payment_date:'2026-02-30',payments:[]},0));
await as('super_admin');const audit=await q("select actor,action from rental_audit where tbl='rental_contracts' order by id");assert.equal(audit[0].actor,ids.admin);assert.equal(audit[1].actor,ids.admin);
await grant('admin',false,1);await as('admin');assert.equal(await can(),false);assert.equal((await q('select * from rental_contracts_flat')).length,0);await assert.rejects(()=>save('contracts','DEMO1',{monthly:1},2,true));
await db.exec('reset role');await db.query('update staff_memberships set active=false where user_id=$1',[ids.office_admin]);await as('office_admin');assert.equal(await can(),false);
await db.exec('reset role');await db.query("update staff_memberships set active=true,role='sales' where user_id=$1",[ids.office_admin]);await as('office_admin');assert.equal(await can(),false);
await db.close();console.log('PASS rental RLS, explicit grants, revocation, inactive/demoted roles, audit, settings, ISO dates and concurrent payment protection');
