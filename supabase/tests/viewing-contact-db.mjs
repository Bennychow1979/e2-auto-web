import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

const db=new PGlite();let passed=0;
const ok=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);passed++;console.log('PASS '+label)};
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
alter table storage.objects enable row level security;grant usage on schema public,auth,storage to anon,authenticated,service_role;
grant select,insert,update,delete on storage.objects to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
alter default privileges in schema public grant execute on functions to anon,authenticated;
alter default privileges in schema public grant all on tables to service_role;`);
for(const file of readdirSync('supabase/migrations').filter(f=>f<'202609180001'))await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
for(const file of ['202609220001_partner_referrals.sql','202610010002_viewing_bookings.sql','202610200006_viewing_rotation_notifications.sql','202610200007_viewing_notification_dispatch.sql','202611230001_viewing_status_corrections.sql','20261123035758_viewing_contact_verification.sql'])await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));

const fresh=randomUUID(),mismatch=randomUUID(),expired=randomUUID();
for(const [id,phone,age] of [[fresh,'60123871066',0],[mismatch,'60123456789',0],[expired,'60123871066',91]]) {
  await db.query(`insert into public.e2_viewings(id,customer_name,phone,vehicle_label,preferred_date,preferred_time,locale,submission_fingerprint,privacy_version,consent_at,created_at)
    values($1::uuid,'Synthetic private name',$2,'Synthetic car',current_date,'10:00','en',$1::text,'test',now(),now()-make_interval(days=>$3))`,[id,phone,age]);
}
const verify=(id,phone='+60123871066')=>scalar('select public.e2_verify_viewing_contact($1,$2)',[id,phone]);
for(const role of ['anon','authenticated']) {
  await db.exec('set role '+role);
  await assert.rejects(verify(fresh));passed++;
  await assert.rejects(scalar('select public.e2_viewing_contact_rate_slot()'));passed++;
  await assert.rejects(db.query('select * from e2_contact_private.rate_limit'));passed++;
  await db.exec('reset role');
}
await db.exec('set role service_role');
const first=await verify(fresh,'012-387 1066');
ok(first.match,true,'Local format matches full international number');ok(first.already_verified,false,'First match reports unverified before this call');
ok(Object.keys(first).sort(),['already_verified','found','match','preferred_date','vehicle_label'],'Match field allowlist');
const row=await scalar('select to_jsonb(v) from public.e2_viewings v where id=$1',[fresh]);
ok(row.contact_verified_at!==null,true,'First match sets verification timestamp');ok(row.revision,2,'Revision increments to protect concurrent staff edits');
ok(await scalar("select details from public.e2_viewing_events where viewing_id=$1 and action='contact_verified'",[fresh]),{source:'aira_whatsapp'},'Minimal first-match audit');
const repeats=await Promise.all(Array.from({length:5},()=>verify(fresh)));
ok(repeats.every(r=>r.already_verified),true,'Concurrent retries report already verified');
ok(await scalar('select to_jsonb(v) from public.e2_viewings v where id=$1',[fresh]),row,'Retries do not update the row');
ok(await scalar("select count(*)::int from public.e2_viewing_events where viewing_id=$1 and action='contact_verified'",[fresh]),1,'Only one verified event');
const before=await scalar('select to_jsonb(v) from public.e2_viewings v where id=$1',[mismatch]);
const wrong=await verify(mismatch);
ok(wrong.match,false,'Different full number mismatches');ok(wrong.form_last4,'6789','Only form last four returned');
ok(await scalar('select to_jsonb(v) from public.e2_viewings v where id=$1',[mismatch]),before,'Mismatch leaves every viewing column unchanged');
ok(await scalar("select details from public.e2_viewing_events where viewing_id=$1 and action='contact_mismatch'",[mismatch]),{wa_last4:'1066'},'Mismatch event stores only incoming last four');
const sameSuffix=await verify(fresh,'+65123871066');ok(sameSuffix.match,false,'Matching suffix does not mean matching phone');ok(sameSuffix.already_verified,true,'Mismatch does not erase prior verification');
ok(await verify(expired),{found:false},'Older than 90 days is hidden');ok(await verify(randomUUID()),{found:false},'Unknown ID is hidden');
ok(await scalar("select count(*)::int from public.e2_viewing_events where viewing_id=$1 and action like 'contact_%'",[expired]),0,'Expired requests create no contact events');
for(const phone of [null,'','abc','0','1'.repeat(129)])ok(await verify(fresh,phone),{found:false},'Invalid phone cannot update through RPC');

// The timestamp update must roll back if audit insertion fails.
await db.exec('reset role');
await db.exec(`create function public.test_reject_contact_event() returns trigger language plpgsql as $$begin if new.action='contact_verified' then raise exception 'synthetic failure'; end if;return new;end$$;
create trigger test_reject_contact_event before insert on public.e2_viewing_events for each row execute function public.test_reject_contact_event();set role service_role;`);
await assert.rejects(verify(mismatch,'0123456789'));passed++;
ok(await scalar('select to_jsonb(v) from public.e2_viewings v where id=$1',[mismatch]),before,'Audit failure rolls verification back atomically');

const slots=await Promise.all(Array.from({length:61},()=>scalar('select public.e2_viewing_contact_rate_slot()')));
ok(slots.filter(Boolean).length,60,'Shared rate limiter admits exactly 60 requests');ok(slots[60],false,'Request 61 is rejected');
await db.query("update e2_contact_private.rate_limit set accepted_at=array_fill(now()-interval '61 seconds',array[60])");
ok(await scalar('select public.e2_viewing_contact_rate_slot()'),true,'Quota recovers after the rolling window');
ok(await scalar('select cardinality(accepted_at) from e2_contact_private.rate_limit'),1,'Expired limiter entries are pruned');
await db.close();console.log(`${passed} viewing contact database checks passed`);
