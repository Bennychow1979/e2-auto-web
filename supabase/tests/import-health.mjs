// Daily import health report: synthetic data, Vault and pg_net stubs only.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite(),actor='00000000-0000-4000-8000-000000000001',reader='00000000-0000-4000-8000-000000000002';
const TOKEN='123456:SYNTHETIC-BOT-TOKEN',CHAT='-1001234567890';
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create schema net;create schema vault;create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table public.staff_memberships(user_id uuid primary key,role text,active boolean default true);
create table public.vehicles(id uuid primary key default gen_random_uuid(),plate text,publication text,price numeric,created_at timestamptz default now());
create table public.vehicle_import_jobs(folder_id text primary key,status text,plate text,issue text);
grant usage on schema public,auth to anon,authenticated,service_role;
grant select on public.staff_memberships to authenticated;
create table vault.decrypted_secrets(name text primary key,decrypted_secret text);
create table net.test_requests(id bigint generated always as identity,url text,headers jsonb,body jsonb,timeout integer);
create function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 1000) returns bigint language sql as $$
insert into net.test_requests(url,headers,body,timeout) values(url,headers,body,timeout_milliseconds) returning id $$;`);
await db.exec(readFileSync('supabase/migrations/202609210002_vehicle_import_schedule.sql','utf8'));
await db.exec(readFileSync('supabase/migrations/202610170001_import_health.sql','utf8'));
await db.query('insert into auth.users values($1),($2)',[actor,reader]);
await db.query("insert into public.staff_memberships(user_id,role) values($1,'super_admin'),($2,'sales')",[actor,reader]);
await db.query('insert into public.vehicle_import_schedule(actor_id,enabled) values($1,true)',[actor]);
await db.query("insert into public.vehicles(plate,publication,created_at) values('VAB1001','published','2026-10-01'),('VAB1002','draft','2026-10-01')");
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
const as=role=>db.exec('reset role;set role '+role);
// 09:30 Malaysia = 01:30 UTC.
const at=day=>day+'T01:30:00Z';
const check=async day=>(await one('select public.e2_import_health_check($1) r',[at(day)])).r;
const sent=async()=>(await db.query('select * from net.test_requests order by id')).rows;
const dailyRun=(day,status,summary={created:[],blocked:[]})=>db.query("insert into public.vehicle_import_runs(run_kind,scheduled_day,actor_id,status,summary,lease_until,finished_at) values('daily',$1,$2,$3,$4,now()+interval '1 day',now())",[day,actor,status,JSON.stringify(summary)]);

// Not configured: the report is still written; nothing is sent, nothing throws.
await dailyRun('2026-10-19','failed',{created:[],blocked:[],error:'Scheduled request did not complete.'});
let r=await check('2026-10-19');
assert.equal(r.status,'failed');assert.equal(r.notify_reason,'new_issue');assert.equal(r.telegram_error,'Telegram is not configured in Vault.');
assert.equal((await sent()).length,0);
await db.query("insert into vault.decrypted_secrets values('e2_telegram_bot_token',$1),('e2_telegram_chat_id',$2)",[TOKEN,CHAT]);

// A configured re-check of an unchanged fault on the same day is not resent.
r=await check('2026-10-19');assert.equal((await sent()).length,0,'Same-day unchanged result never sends twice');

// Day 2, same fault: no message (no repeated alerts for one fault).
await dailyRun('2026-10-20','failed',{created:[],blocked:[],error:'Scheduled request did not complete.'});
r=await check('2026-10-20');assert.equal(r.status,'failed');assert.equal(r.notify_reason,null);assert.equal((await sent()).length,0);

// Day 3, different fault: one alert with the details and the shared counts.
await dailyRun('2026-10-21','completed',{created:[{plate:'VAB2001',price:45990,photos:8}],blocked:[{plate:'BQU2828',issue:'Duplicate plate rows in MASTERLIST.'}]});
await db.query("insert into public.vehicle_import_jobs values('folder_000000001','blocked','BQU2828','Duplicate plate rows in MASTERLIST.')");
await db.query("insert into public.vehicles(plate,publication,price,created_at) values('VAB2001','draft',45990,'2026-10-20T03:00:00Z')");
r=await check('2026-10-21');assert.equal(r.status,'warning');assert.equal(r.notify_reason,'new_issue');
assert.equal(r.metrics.created,1);assert.deepEqual(r.metrics.created_list,[{plate:'VAB2001',price:45990}]);assert.equal(r.metrics.blocked_open,1);
let msgs=await sent();assert.equal(msgs.length,1);
assert.equal(msgs[0].url,'https://api.telegram.org/bot'+TOKEN+'/sendMessage');assert.equal(msgs[0].body.chat_id,CHAT);
assert.match(msgs[0].body.text,/^⚠️ E2 导入异常 · 21\/10\/2026/);assert.match(msgs[0].body.text,/需核对 BQU2828: Duplicate plate rows/);
assert.match(msgs[0].body.text,/今日新建草稿 1 · 待核对文件夹 1 · 车辆 3（草稿 2）/);
assert.match(msgs[0].body.text,/新草稿 1 台: VAB2001 RM45,990\n发布前请核对/);
assert.deepEqual(r.metrics.new_drafts,[{plate:'VAB2001',price:45990}]);

// Day 4 (Thursday), healthy: a single recovery message.
await dailyRun('2026-10-22','completed');r=await check('2026-10-22');
assert.equal(r.status,'ok');assert.equal(r.notify_reason,'recovered');msgs=await sent();assert.equal(msgs.length,2);assert.match(msgs[1].body.text,/^✅ E2 导入已恢复正常/);
// Day 5 (Friday), healthy: silent.
await dailyRun('2026-10-23','completed');r=await check('2026-10-23');assert.equal(r.notify_reason,null);assert.equal((await sent()).length,2);
// Saturday, healthy, but a draft was added after Friday's check (portal or manual): one 🆕 message.
await db.query("insert into public.vehicles(plate,publication,price,created_at) values('VAB3001','draft',null,'2026-10-24T05:00:00Z'),('VAB3002','published',38990,'2026-10-24T06:00:00Z')");
await dailyRun('2026-10-25','completed');r=await check('2026-10-25');assert.equal(r.status,'ok');assert.equal(r.notify_reason,'new_drafts');
msgs=await sent();assert.equal(msgs.length,3);assert.match(msgs[2].body.text,/^🆕 E2 新草稿 · 25\/10\/2026/);
assert.match(msgs[2].body.text,/新草稿 1 台: VAB3001\n/,'Only drafts since the previous check; a missing price is omitted, published cars are not listed');
// Monday, healthy: weekly all-clear so silence is never ambiguous.
await dailyRun('2026-10-26','completed');r=await check('2026-10-26');assert.equal(r.notify_reason,'weekly_ok');assert.match((await sent())[3].body.text,/^✅ E2 导入本周正常/);
assert.deepEqual(r.metrics.new_drafts,[],'Drafts already reported are not repeated');

// No run although the schedule is on; duplicate stock plates; stuck runs.
await db.query("insert into public.vehicles(plate,publication,created_at) values('vab 1001','draft','2026-10-26T10:00:00Z')");
r=await check('2026-10-27');assert.equal(r.status,'failed');
assert.deepEqual(r.findings.map(f=>f.code).sort(),['duplicate_plates','no_run']);assert.match(r.findings.find(f=>f.code==='duplicate_plates').message,/VAB1001/);
await db.query("insert into public.vehicle_import_runs(run_kind,scheduled_day,actor_id,status,lease_until) values('test','2026-10-28',$1,'running','2026-10-28T01:00:00Z')",[actor]);
await db.query("update public.vehicle_import_schedule set enabled=false");
r=await check('2026-10-28');assert.deepEqual(r.findings.map(f=>f.code).sort(),['duplicate_plates','schedule_off','stuck_run']);

// The bot token and chat ID are never stored in the report table.
const stored=JSON.stringify((await db.query('select * from public.import_health_reports')).rows);
assert(!stored.includes(TOKEN)&&!stored.includes(CHAT),'Secrets stay in Vault');
assert(!JSON.stringify(r).includes('telegram_request'));

// Access: only the database scheduler runs checks; admins may read reports.
await as('anon');await assert.rejects(()=>check('2026-10-29'),/permission denied/);await assert.rejects(()=>db.query('select * from public.import_health_reports'),/permission denied/);
await as('service_role');await assert.rejects(()=>check('2026-10-29'),/permission denied/);await assert.rejects(()=>db.query("select public.e2_send_import_health_telegram('2026-10-21')"),/permission denied/);
await as('authenticated');await db.exec(`set request.jwt.claim.sub='${reader}'`);
assert.equal((await db.query('select * from public.import_health_reports')).rows.length,0,'Non-admin staff cannot read reports');
await db.exec(`set request.jwt.claim.sub='${actor}'`);
assert((await db.query('select report_day,status from public.import_health_reports')).rows.length>=8,'Admins can read reports');
await assert.rejects(()=>check('2026-10-29'),/permission denied/);
console.log('Import health: report per day, alerts only for new faults/recovery/new drafts/Monday, Vault-only secrets and access checks passed.');
