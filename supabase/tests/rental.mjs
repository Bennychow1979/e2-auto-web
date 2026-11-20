import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create table auth.users(id uuid primary key,email text);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,public to anon,authenticated,service_role;
 create table public.staff_profiles(user_id uuid primary key,display_name text);
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
await db.exec(await readFile(new URL('../migrations/20261115180050_rental_staff_tracker.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../migrations/20261115183217_rental_audit_viewer.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../migrations/20261116033047_rental_profile_actor_names.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../migrations/20261120090000_rental_move_plate.sql',import.meta.url),'utf8'));
await db.query('insert into staff_profiles values($1,$2),($3,$4)',[ids.admin,'  Demo Admin  ',ids.office_admin,'   ']);
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
 await assert.rejects(()=>q('select rental_identity()'));await assert.rejects(()=>grant('admin',true,0));await assert.rejects(()=>save('contracts','DEMO1',{plate:'DEMO1',payments:[]},0));
 await assert.rejects(()=>q('select * from rental_audit_list_v2()'));await assert.rejects(()=>q('select * from rental_audit_list()'));await assert.rejects(()=>q('select rental_audit_detail(1)'));
}
await as('super_admin');assert.equal(await can(),true);assert.equal((await q('select * from rental_list_access()')).length,3);
await assert.rejects(()=>grant('sales',true,0));await assert.rejects(()=>grant('inactive',true,0));
await grant('admin',true,0);await grant('office_admin',true,0);await assert.rejects(()=>grant('admin',false,0));
await as('admin');assert.equal(await can(),true);assert.equal((await q('select rental_identity() x'))[0].x.display_name,'Demo Admin');
await q("select set_config('request.headers','{\"x-actor\":\"Forged Name\"}',false)");
await save('contracts','DEMO1',{plate:'DEMO1',first_payment_date:'2026-08-12',payments:[],handovers:[],monthly:500},0);
assert.equal((await q('select first_payment_date::text d from rental_contracts'))[0].d,'2026-08-12');
await assert.rejects(()=>q("update rental_contracts set data='{}'"));await assert.rejects(()=>q('delete from rental_contracts'));await assert.rejects(()=>q('update rental_access set enabled=true'));
await assert.rejects(()=>save('contracts','DEMO1',{payments:[{amount:500}]},0,true));
await save('contracts','DEMO1',{payments:[{amount:500}]},1,true);
await as('office_admin');assert.equal(await can(),true);assert.equal((await q('select rental_identity() x'))[0].x.display_name,'office_admin@example.test');assert.equal((await q('select * from rental_contracts')).length,1);
await assert.rejects(()=>q('select * from rental_audit_list_v2()'));await assert.rejects(()=>q('select * from rental_audit_list()'));await assert.rejects(()=>q('select rental_audit_detail(1)'));
await assert.rejects(()=>save('contracts','DEMO1',{payments:[{amount:600}]},1,true));
assert.deepEqual((await q('select data from rental_contracts'))[0].data.payments,[{amount:500}]);
await save('settings','lists',{agents:['DEMO'],financiers:[],partners:[]},1);
await assert.rejects(()=>save('contracts','DEMO1',{plate:'CHANGED'},2,true));
await assert.rejects(()=>save('contracts','DEMO2',{plate:'DEMO2',first_payment_date:'2026-02-30',payments:[]},0));
await as('super_admin');const audit=await q("select actor,action from rental_audit where tbl='rental_contracts' order by id");assert.equal(audit[0].actor,ids.admin);assert.equal(audit[1].actor,ids.admin);
const logs=await q("select * from rental_audit_list(null,'demo1',20)");assert.equal(logs.length,2);assert.equal(logs[0].actor_email,'admin@example.test');assert.equal(logs[0].plate,'DEMO1');assert.equal(logs[0].kind,'payment');assert.equal(logs[1].kind,'vehicle_added');assert.equal(typeof logs[0].id,'string');assert.equal(logs[0].old,undefined);
const detail=(await q('select rental_audit_detail($1) data',[logs[0].id]))[0].data;assert.deepEqual(detail.before.payments,[]);assert.deepEqual(detail.after.payments,[{amount:500}]);
const first=await q("select * from rental_audit_list(null,'DEMO1',1)");const second=await q("select * from rental_audit_list($1,'DEMO1',1)",[first[0].id]);assert.equal(first[0].id,logs[0].id);assert.equal(second[0].id,logs[1].id);
assert.equal((await q("select * from rental_audit_list(null,'NO-MATCH',20)")).length,0);
await assert.rejects(()=>q('select * from rental_audit_list(null,\'\',21)'));await assert.rejects(()=>q('select rental_audit_detail(99999999)'));
await assert.rejects(()=>q('delete from rental_audit'));await assert.rejects(()=>q("update rental_audit set actor=null"));
// Audit snapshot survives profile renames; legacy rows resolve the current name.
const named=await q("select * from rental_audit_list_v2(null,'DEMO1',20)");assert.equal(named[0].actor,ids.admin);assert.equal(named[0].actor_display_name,'Demo Admin');assert.equal(named[1].actor_display_name,'Demo Admin');
assert.equal((await q("select * from rental_audit_list_v2(null,'',20)")).find(x=>x.tbl==='rental_settings').actor_display_name,'office_admin@example.test');
await db.exec('reset role');await db.query('update staff_profiles set display_name=$1 where user_id=$2',['Renamed Admin',ids.admin]);
await db.query('update rental_audit set actor_display_name=null where id=$1',[named[1].id]);
await as('super_admin');const renamed=await q("select * from rental_audit_list_v2(null,'DEMO1',20)");assert.equal(renamed[0].actor_display_name,'Demo Admin');assert.equal(renamed[1].actor_display_name,'Renamed Admin');
assert.equal((await q('select rental_identity() x'))[0].x.display_name,'super_admin@example.test');
await assert.rejects(()=>q("select * from rental_audit_list_v2(null,'',21)"));
await grant('admin',false,1);await as('admin');assert.equal(await can(),false);assert.equal((await q('select * from rental_contracts_flat')).length,0);await assert.rejects(()=>save('contracts','DEMO1',{monthly:1},2,true));
await db.exec('reset role');await db.query('update staff_memberships set active=false where user_id=$1',[ids.office_admin]);await as('office_admin');assert.equal(await can(),false);
await db.exec('reset role');await db.query("update staff_memberships set active=true,role='sales' where user_id=$1",[ids.office_admin]);await as('office_admin');assert.equal(await can(),false);
await db.exec('reset role');await db.query('update staff_memberships set active=false where user_id=$1',[ids.super_admin]);await as('super_admin');await assert.rejects(()=>q('select * from rental_audit_list_v2()'));await assert.rejects(()=>q('select * from rental_audit_list()'));await assert.rejects(()=>q('select rental_audit_detail(1)'));
console.log('PASS rental RLS, explicit grants, revocation, inactive/demoted roles, audit, settings, ISO dates and concurrent payment protection');

// --- rental_move_plate: atomic plate correction -------------------------------------------------
const move=(oldId,newId,plate,revision,patch={})=>q('select public.rental_move_plate($1,$2,$3,$4,$5) result',[oldId,newId,plate,revision,patch]);
await db.exec('reset role');await db.query('update staff_memberships set active=true where user_id=$1',[ids.super_admin]);
await as('super_admin');{const acc=(await q('select * from rental_list_access()')).find(a=>a.user_id===ids.admin);await grant('admin',true,acc.revision);}
for(const role of ['anon','sales','runner','account','customer','inactive','office_admin']){await as(role);await assert.rejects(()=>move('DEMO1','DEMO9','DEMO9',2),role+' move');}
await as('admin');const demoRev=(await q("select revision from rental_contracts where id='DEMO1'"))[0].revision;
const beforeMove=(await q("select id,data,revision from rental_contracts order by id")).map(r=>({id:r.id,rev:r.revision,plate:r.data.plate,status:r.data.car_status,payments:r.data.payments}));
await assert.rejects(()=>move('DEMO1','DEMO9','DEMO9',demoRev-1),/Record changed/);               // stale revision
await assert.rejects(()=>move('DEMO1','DEMO1','DEMO1',demoRev),/same as the current/);         // no-op move
await assert.rejects(()=>move('DEMO1','demo 9','DEMO9',demoRev),/Invalid vehicle id/);         // id must be normalised
await assert.rejects(()=>move('DEMO1','DEMO9','ABC1',demoRev),/do not match/);                  // id/plate mismatch
await assert.rejects(()=>move('DEMO1','DEMO9','DEMO9',demoRev,{payments:[]}),/may not change/);  // patch cannot touch protected fields
await assert.rejects(()=>move('NOPE','DEMO9','DEMO9',0),/not found/);
await save('contracts','TAKEN',{plate:'TAKEN',payments:[],handovers:[]},0);
await assert.rejects(()=>move('DEMO1','TAKEN','TAKEN',demoRev),/already exists/);
assert.deepEqual((await q("select id,data,revision from rental_contracts order by id")).map(r=>({id:r.id,rev:r.revision,plate:r.data.plate,status:r.data.car_status,payments:r.data.payments})),
 [...beforeMove,{id:'TAKEN',rev:1,plate:'TAKEN',status:undefined,payments:[]}],'failed moves must change nothing');
await q("select set_config('request.headers','{\"x-actor\":\"Forged Name\"}',false)");
const moved=(await move('DEMO1','DEMO-9','DEMO 9',demoRev,{owner_name:'FIXED OWNER',pay_reference:'DEMO1'}))[0].result;
assert.equal(moved.record.id,'DEMO-9');assert.equal(moved.record.revision,1);assert.equal(moved.record.data.plate,'DEMO 9');
assert.equal(moved.record.data.plate_changed_from,'DEMO1');assert.ok(Array.isArray(moved.record.data.payments));assert.equal(moved.record.data.owner_name,'FIXED OWNER');
assert.equal(moved.record.data.pay_reference,'DEMO 9');assert.equal(moved.record.data.history.at(-1).by,'Renamed Admin');assert.equal(moved.record.data.history.at(-1).by_id,ids.admin);
assert.equal(moved.moved_from.id,'DEMO1');assert.equal(moved.moved_from.revision,demoRev+1);assert.equal(moved.moved_from.data.car_status,'MOVED');assert.equal(moved.moved_from.data.moved_to,'DEMO-9');assert.equal(moved.moved_from.data.plate,'DEMO1');
await assert.rejects(()=>move('DEMO1','DEMO8','DEMO8',demoRev+1),/already moved/);                  // cannot move a moved record again
await assert.rejects(()=>save('contracts','DEMO-9',{plate:'DEMO9X'},1,true),/cannot change/); // rental_save still refuses plate edits
await save('contracts','DEMO-9',{payments:[{amount:500},{amount:500}]},1,true);              // normal saves continue on the new id
await as('super_admin');
const moveAudit=await q("select row_id,action,actor from rental_audit where tbl='rental_contracts' and row_id in ('DEMO1','DEMO-9') order by id desc limit 3");
assert.deepEqual(moveAudit.map(a=>a.row_id+':'+a.action),['DEMO-9:UPDATE','DEMO1:UPDATE','DEMO-9:INSERT']);assert.ok(moveAudit.every(a=>a.actor===ids.admin));
assert.equal((await q("select rental_audit_detail($1) d",[(await q("select id from rental_audit where row_id='DEMO1' order by id desc limit 1"))[0].id]))[0].d.after.car_status,'MOVED');
console.log('PASS rental_move_plate: permissions, validation, atomic rollback on every failure, history/audit actor, plate still frozen in rental_save');

// MOVED rows cannot be revived, edited, appended to, or forged via ordinary saves.
await as('admin');
const frozen=(await q("select data,revision from rental_contracts where id='DEMO1'"))[0];
for(const payload of [{car_status:'SOLD'},{payments:[{amount:999}]},{notes:'hidden edit'}]){
 await assert.rejects(()=>save('contracts','DEMO1',payload,frozen.revision,true),/already moved/);
}
await assert.rejects(()=>save('contracts','DEMO1',{...frozen.data,car_status:'SOLD'},frozen.revision),/already moved/);
assert.deepEqual((await q("select data,revision from rental_contracts where id='DEMO1'"))[0],frozen);
await assert.rejects(()=>save('contracts','FAKE',{plate:'FAKE',car_status:'MOVED'},0),/Use rental_move_plate/);
// Every write path rejects alternate spellings of an existing live plate.
await save('contracts','ABC123',{plate:'aBc 123',payments:[],handovers:[]},0);
await save('contracts','SOURCE1',{plate:'SOURCE1',payments:[],handovers:[]},0);
await assert.rejects(()=>save('contracts','ABC-123',{plate:'ABC-123',payments:[],handovers:[]},0),/already exists/);
await assert.rejects(()=>move('SOURCE1','ABC-123','ABC-123',1),/already exists/);
assert.equal((await q("select count(*)::int n from rental_contracts where id='ABC-123'"))[0].n,0);
// Formatting correction of the same car is allowed; its tombstone is frozen.
await move('ABC123','ABC-123','ABC-123',1);
await assert.rejects(()=>save('contracts','ABC123',{car_status:'SOLD'},2,true),/already moved/);
// A failure after the new INSERT must also roll back both audit entries.
await save('contracts','ROLLBACK1',{plate:'ROLLBACK1',payments:[],handovers:[]},0);
const recordsBefore=await q('select id,data,revision from rental_contracts order by id');
await db.exec('reset role');
const auditBefore=await q('select * from rental_audit order by id');
await db.exec(`create function public.test_reject_move_update() returns trigger language plpgsql as $$begin if old.id='ROLLBACK1' then raise exception 'injected old-row failure'; end if; return new; end$$;
create trigger test_reject_move_update before update on rental_contracts for each row execute function public.test_reject_move_update();`);
await as('admin');
await assert.rejects(()=>move('ROLLBACK1','ROLLBACK2','ROLLBACK2',1),/injected old-row failure/);
assert.deepEqual(await q('select id,data,revision from rental_contracts order by id'),recordsBefore);
await db.exec('reset role');assert.deepEqual(await q('select * from rental_audit order by id'),auditBefore);
await db.exec('drop trigger test_reject_move_update on rental_contracts; drop function test_reject_move_update();');
// Function ACL and definer search paths remain closed to unauthenticated callers.
for(const signature of ['rental_save(text,text,jsonb,bigint,boolean)','rental_move_plate(text,text,text,bigint,jsonb)']){
 const acl=(await q("select has_function_privilege('anon',$1,'EXECUTE') anon,has_function_privilege('authenticated',$1,'EXECUTE') staff",[signature]))[0];
 assert.equal(acl.anon,false);assert.equal(acl.staff,true);
}
console.log('PASS frozen MOVED records, normalized plate uniqueness, formatting-only move, mid-write rollback including audit, and RPC ACLs');

await db.close();
