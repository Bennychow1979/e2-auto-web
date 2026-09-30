import {PGlite} from '@electric-sql/pglite';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {malaysiaDate,dateLimit,viewingTimes} from '../../booking-core.mjs';
import {localizedPage} from '../../scripts/build-languages.mjs';
import {localizedURL,t} from '../../i18n.mjs';
const db=new PGlite();let passed=0;
const ok=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);passed++;console.log('PASS '+label)};
const no=async(p,label)=>{await assert.rejects(p);passed++;console.log('PASS '+label)};
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
alter table storage.objects enable row level security;grant usage on schema public,auth,storage to anon,authenticated,service_role;
grant select,insert,update,delete on storage.objects to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
alter default privileges in schema public grant execute on functions to anon,authenticated;`);
for(const file of readdirSync('supabase/migrations').filter(f=>f<'202609180001'))await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
for(const file of ['202609220001_partner_referrals.sql','202610010002_viewing_bookings.sql'])await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
const [admin,sales,other,customer,office,disabled,partner]=Array.from({length:7},randomUUID);
for(const [i,id] of [admin,sales,other,customer,office,disabled,partner].entries())await db.query('insert into auth.users values($1,$2,now())',[id,`booking${i}@example.test`]);
for(const [id,role,active] of [[admin,'super_admin',true],[sales,'sales',true],[other,'sales',true],[office,'office_admin',true],[disabled,'admin',false]])await db.query('insert into public.staff_memberships(user_id,role,active) values($1,$2,$3)',[id,role,active]);
const cars=[];for(let i=0;i<3;i++){
 const id=await scalar("insert into public.vehicles(plate,brand,model,variant,year,engine_litres,transmission,fuel_type,price) values($1,'Test','Viewing','Auto',2020,1.5,'Auto','PETROL',50000) returning id",['VIEW'+i]);cars.push(id);
 const photo=randomUUID(),path=id+'/'+photo+'.webp';await db.query("insert into storage.objects(bucket_id,name) values('vehicle-photos',$1)",[path]);await db.query('insert into public.vehicle_photos(id,vehicle_id,path,position) values($1,$2,$3,0)',[photo,id,path]);
 if(i===1)await db.query("update public.vehicles set stock_status='Sold' where id=$1",[id]);
 if(i<2)await db.query("update public.vehicles set publication='published' where id=$1",[id]);
}
const day=await scalar("select ((now() at time zone 'Asia/Kuala_Lumpur')::date+1)::text");
const far=await scalar("select ((now() at time zone 'Asia/Kuala_Lumpur')::date+91)::text");
async function as(id){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id||'']);await db.exec('set role '+(id?'authenticated':'anon'))}
const submit=({id=randomUUID(),name='Synthetic viewing',phone='012 345 6789',date=day,time='10:00',consent=true,car=null,lang='en',assigned=null,code=null}={})=>scalar('select public.e2_submit_viewing($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,name,phone,date,time,consent,car,lang,assigned,code]);
const update=({id,rev=1,status='Confirmed',assigned=sales,date=day,time='10:00',contact=true,note='Test note'}={})=>db.query('select public.e2_update_viewing($1,$2,$3,$4,$5,$6,$7,$8)',[id,rev,status,assigned,date,time,contact,note]);
await as(null);
await no(db.query('select * from public.e2_viewing_assignees()'),'Anonymous cannot list staff');
for(const table of ['e2_viewings','e2_viewing_events'])await no(db.query('select * from public.'+table),'Anonymous cannot read '+table);
ok(await scalar("select has_function_privilege('anon','public.e2_update_viewing(uuid,bigint,text,uuid,date,time,boolean,text)','execute')"),false,'Public cannot execute staff updates');
await no(submit({consent:false}),'Consent enforced');await no(submit({phone:'abc12345678'}),'Malformed phone rejected');await no(submit({name:' '}),'Blank name rejected');await no(submit({date:far}),'Beyond 90 days rejected');await no(submit({date:'2020-01-01'}),'Past day rejected');await no(submit({time:'23:00'}),'Outside viewing hours rejected');await no(submit({time:'10:07'}),'Non-slot minute rejected');await no(submit({time:null}),'Null time rejected');await no(submit({lang:'fr'}),'Unsupported language rejected');await no(submit({car:cars[1]}),'Sold car rejected');await no(submit({car:cars[2]}),'Draft car rejected');await no(submit({assigned:disabled}),'Disabled staff rejected');await no(submit({code:'BADCODE'}),'Invalid Partner link rejected');
const id=randomUUID(),response=await submit({id,car:cars[0],assigned:sales});
ok(response.id,id,'Online request returns a receipt');ok(response.status,'Requested','Submission does not claim confirmation');ok(Object.keys(response).sort(),['id','preferred_date','preferred_time','status'],'Receipt does not disclose contact data');
ok((await submit({id,car:cars[0],phone:'+60123456789',assigned:sales,lang:'zh'})).id,id,'Retry survives normalization and language switching');
await no(submit({id,car:cars[0],assigned:sales,name:'Different name'}),'Same reference cannot overwrite a request');
await as(admin);ok((await db.query('select * from public.e2_viewing_assignees()')).rows.length,3,'Admin can assign every active eligible staff member');ok(await scalar('select count(*)::int from public.e2_viewings'),1,'Repeat creates only one appointment');ok(await scalar('select count(*)::int from public.e2_viewing_events'),1,'Repeat creates only one event');ok(await scalar('select phone from public.e2_viewings'),'60123456789','Phone normalized');
await no(db.query("update public.e2_viewings set status='Confirmed'"),'Direct table writes denied even to Admin');await no(update({id,contact:false}),'Confirmation requires customer agreement');await no(update({id,status:'Completed'}),'Cannot complete an unconfirmed request');
for(const who of [customer,other,office,disabled,partner]){await as(who);ok(await scalar('select count(*)::int from public.e2_viewings'),0,'Other customer or unauthorized staff cannot read contact data');await no(update({id}),'Unauthorized staff cannot update appointment')}
await as(sales);ok(await scalar('select count(*)::int from public.e2_viewings'),1,'Assigned Sales can read their appointment');await no(update({id,assigned:other}),'Sales cannot reassign');await update({id});await no(update({id}),'Stale revision rejected');
await as(null);const confirmed=await submit({id,car:cars[0],assigned:sales});ok(confirmed.status,'Confirmed','Exact retry returns updated status without duplicate');ok(confirmed.confirmed_date,day,'Confirmed time included in receipt');
await as(admin);await update({id,rev:2,status:'Cancelled'});await no(update({id,rev:3}),'Cancelled appointment cannot silently reopen');ok(await scalar('select stock_status from public.vehicles where id=$1',[cars[0]]),'Available','Appointments do not reserve stock');
await scalar('select public.e2_save_partner($1,$2,$3,$4,$5)',['booking6@example.test','Test Partner',50000,true,0]);const code=await scalar('select code from public.e2_partners');
await as(null);const referred=randomUUID();await submit({id:referred,phone:'0191111111',code,car:cars[0]});await submit({id:referred,phone:'0191111111',code,car:cars[0]});
await as(admin);ok(await scalar('select count(*)::int from public.e2_referral_requests'),1,'Partner booking creates one linked enquiry');ok(await scalar('select referral_request_id from public.e2_viewings where id=$1',[referred]),referred,'Referral attribution is linked');ok(await scalar('select count(*)::int from public.e2_referral_commissions'),0,'Booking never creates a commission');
await as(null);const general=randomUUID();await submit({id:general,phone:'0192222222',code});await as(admin);ok(await scalar('select ref_code from public.e2_viewings where id=$1',[general]),code,'General visit retains Partner code');
await as(null);for(let i=0;i<5;i++)await submit({phone:'0193333333'});await no(submit({phone:'0193333333'}),'Phone rate limit enforced on new requests');
await db.exec('reset role');await db.query('update public.staff_memberships set active=false where user_id=$1',[sales]);await as(sales);ok(await scalar('select count(*)::int from public.e2_viewings'),0,'Revoked staff session loses access immediately');
const beforeMidnight=new Date('2026-10-01T15:45:00Z');ok(malaysiaDate(beforeMidnight),'2026-10-01','Date uses Malaysia timezone');ok(malaysiaDate(new Date('2026-10-01T16:01:00Z')),'2026-10-02','Malaysia midnight handled');ok(dateLimit(new Date('2026-10-01T00:00:00Z')),'2026-12-30','90-day limit');
const earlier=new Date('2026-10-01T00:00:00Z');ok(viewingTimes('2026-10-04',earlier).at(0),'10:00','Sunday starts at 10');ok(viewingTimes('2026-10-04',earlier).at(-1),'16:30','Sunday last slot before closing');ok(viewingTimes('2026-10-02',earlier).at(0),'09:30','Weekday starts at 9:30');ok(viewingTimes('2026-10-02',earlier).at(-1),'18:00','Weekday last slot before closing');ok(viewingTimes('2026-10-01',new Date('2026-10-01T02:15:00Z')).at(0),'10:30','Past times filtered');ok(viewingTimes('2026-10-32',earlier),[],'Invalid calendar day rejected');
const source=readFileSync('booking.html','utf8');for(const lang of ['ms','zh']){
 const html=localizedPage(source,'booking.html',lang);ok(html.includes('href="https://e2auto.my/'+lang+'/booking.html"'),true,'Booking canonical '+lang);ok(html.includes(t('Submit viewing request',{},lang)),true,'Booking form translated '+lang);ok(html.includes('src="../booking.js?v=1"'),true,'Localized script path '+lang);ok(html.includes('href="/'+lang+'/booking.html" data-language="'+lang+'" aria-current="page"'),true,'Static language link '+lang);
 const url=new URL(localizedURL('https://e2auto.my/booking.html?id='+cars[0]+'&ref=E2TEST&sales='+sales,lang));ok(url.pathname,'/'+lang+'/booking.html','Booking language routing '+lang);ok(url.searchParams.get('ref'),'E2TEST','Referral survives language switch '+lang);
}
ok(/advertising\.js/.test(source),false,'Booking page does not load advertising tracking');
await db.close();console.log('Bookings: '+passed+' checks passed.');
