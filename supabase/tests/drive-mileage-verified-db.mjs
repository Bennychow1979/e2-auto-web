import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite(),actor='00000000-0000-4000-8000-000000000001',car='00000000-0000-4000-8000-000000000002';
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema net;create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table public.staff_memberships(user_id uuid primary key,role text,active boolean default true);grant usage on schema public,auth to anon,authenticated,service_role;grant select on public.staff_memberships to authenticated;
create table public.vehicles(id uuid primary key,plate text,publication text default 'draft',lifecycle_state text default 'active',mileage integer,mileage_confirmed boolean default false,updated_at timestamptz default clock_timestamp());
create table public.inventory_audit(actor uuid,entity text,action text,row_id uuid);
create function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 1000) returns bigint language sql as $$select 1::bigint$$;
create function public.test_version() returns trigger language plpgsql as $$begin new.updated_at=clock_timestamp();return new;end$$;create trigger version before update on public.vehicles for each row execute function public.test_version();`);
for(const file of ['202609210002_vehicle_import_schedule','20261118173130_drive_mileage_import_budget','20261118175244_drive_mileage_verified_readings'])await db.exec(readFileSync('supabase/migrations/'+file+'.sql','utf8'));
await db.query('insert into auth.users values($1)',[actor]);await db.query("insert into public.staff_memberships values($1,'super_admin',true)",[actor]);await db.query("insert into public.vehicles(id,plate) values($1,'ABC123')",[car]);
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];let sequence=0;
const claim=async()=>(await one("select public.e2_claim_drive_mileage($1,$2,(select updated_at from public.vehicles where id=$2),'ABC123','folder_1234567890','photo_1234567890',$3) r",[actor,car,(++sequence).toString(16).padStart(32,'0')])).r;
const clear=n=>({clear:true,unit:'km',display:'odometer',reading:n,digits:String(n),digit_count:String(n).length});
const finish=async(id,reading,evidence,issue=null)=>(await one('select public.e2_finish_drive_mileage_verified($1,$2,$3,$4,$5::jsonb,4000,80) r',[id,actor,reading,issue,JSON.stringify(evidence)])).r;
for(const evidence of [[],[clear(91533)],[clear(91533),clear(9533)],[clear(91533),{...clear(91533),clear:false}],[clear(91533),{...clear(91533),unit:'mile'}],[clear(91533),{...clear(91533),digit_count:4}]]){
 const c=await claim();assert.equal((await finish(c.id,91533,evidence)).status,'review');assert.equal((await one('select mileage,mileage_confirmed from vehicles')).mileage,null);assert.equal((await one('select mileage_confirmed from vehicles')).mileage_confirmed,false);
}
const good=await claim();assert.equal((await finish(good.id,91533,[clear(91533),clear(91533)])).status,'applied');assert.deepEqual(await one('select mileage,mileage_confirmed from vehicles'),{mileage:91533,mileage_confirmed:true});assert.equal((await claim()).status,'changed','Confirmed mileage protected');
await db.exec('update vehicles set mileage=null,mileage_confirmed=false');const conflict=await claim();await db.exec('update vehicles set mileage=123');assert.equal((await finish(conflict.id,91533,[clear(91533),clear(91533)])).status,'review');assert.equal((await one('select mileage from vehicles')).mileage,123);
await db.exec("update vehicles set publication='published'");assert.equal((await claim()).status,'changed');await db.exec("update vehicles set publication='draft',lifecycle_state='trashed'");assert.equal((await claim()).status,'changed');await db.exec("update vehicles set lifecycle_state='active'");
await db.exec('update drive_mileage_budget set reserved_sen=492');assert.equal((await claim()).status,'claimed');assert.equal((await one('select reserved_sen from drive_mileage_budget')).reserved_sen,498);assert.equal((await claim()).status,'budget');
await db.exec('set role authenticated');await assert.rejects(()=>finish(good.id,1,[]),/permission denied/);
await db.close();console.log('Verified mileage: two matching full readings required; confirmation, conflicts, active Draft scope, permissions and 6-sen cap passed.');
