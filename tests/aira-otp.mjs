import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {normalizePhone,hasVerifiedContact} from '../customer-phone-auth.mjs';
import {validateJob,messageRequest,deliveryAccepted} from '../scripts/aira-otp/worker-core.mjs';
test('normalization refuses malformed/international destinations',()=>{
 for(const n of ['012 345 6789','+60123456789','0060123456789','60123456789'])assert.equal(normalizePhone(n),'+60123456789');
 for(const n of ['60123','+6512345678','+60abc123456789','60123456789@s.whatsapp.net','+60123456789;cmd',''])assert.throws(()=>normalizePhone(n));
 assert.equal(hasVerifiedContact({user_metadata:{phone_verified:true}}),false);
 assert.equal(hasVerifiedContact({phone_confirmed_at:'2026-01-01'}),true);
 assert.equal(hasVerifiedContact({email_confirmed_at:'2026-01-01'}),true);
});
test('worker is destination-bound, expiry-bound and requires delivery evidence',()=>{
 const j={id:'00000000-0000-4000-8000-000000000001',phone:'60123456789',otp:'012345',expires_at:new Date(Date.now()+240000).toISOString()};
 assert.equal(validateJob(j,j.phone),j);
 assert.throws(()=>validateJob(j,'60123456788'));assert.throws(()=>validateJob({...j,otp:'12345x'},j.phone));
 assert.throws(()=>validateJob({...j,expires_at:'invalid'},j.phone));assert.throws(()=>validateJob({...j,expires_at:new Date().toISOString()},j.phone));
 assert.equal(messageRequest(j,'default').tool,'message');assert.equal(messageRequest(j,'default').args.target,'+60123456789');
 assert.equal(messageRequest(j,'default').sessionKey,'agent:main:e2-otp-pilot');
 assert.equal(deliveryAccepted({ok:true,result:{details:{messageId:'wa-test'}}}),true);
 assert.equal(deliveryAccepted({ok:true,result:{details:{channel:'whatsapp',result:{messageId:'wa-test'},messageDelivery:{partialDelivery:false}}}}),true);
 assert.equal(deliveryAccepted({ok:true,result:{details:{result:{messageId:'wa-test'},messageDelivery:{partialDelivery:true}}}}),false);
 for(const v of [{ok:true},{ok:false},{ok:true,result:{isError:true,details:{messageId:'x'}}},{ok:true,result:{content:[{type:'text',text:'{"error":"offline"}'}]}}])assert.equal(deliveryAccepted(v),false);
});
test('broker permissions, throttles, expiry and phone customer authorization',async()=>{
 const db=new PGlite();
 // PGlite lacks pgcrypto. These stand-ins test grants/control flow, not encryption.
 // Real pgcrypto is separately verified before enabling the pilot.
 await db.exec(`
 create role anon;create role authenticated;create role service_role;create role supabase_auth_admin;
 create schema auth;create schema extensions;
 create table auth.users(id uuid primary key,email_confirmed_at timestamptz,phone text,phone_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.staff_memberships(user_id uuid,active boolean);
 create function extensions.gen_random_bytes(n int) returns bytea language sql as $$select decode(repeat('aa',n),'hex')$$;
 create function extensions.digest(s text,a text) returns bytea language sql as $$select sha256(convert_to(s,'utf8'))$$;
 create function extensions.hmac(s text,k text,a text) returns bytea language sql as $$select sha256(convert_to(k||s,'utf8'))$$;
 create function extensions.pgp_sym_encrypt(s text,k text,o text) returns bytea language sql as $$select convert_to(s,'utf8')$$;
 create function extensions.pgp_sym_decrypt(s bytea,k text) returns text language sql as $$select convert_from(s,'utf8')$$;
 grant usage on schema auth,public to anon,authenticated,service_role,supabase_auth_admin;
 `);
 await db.exec(await readFile(new URL('../supabase/migrations/20261125181751_aira_whatsapp_auth_pilot.sql',import.meta.url),'utf8'));
 const token='a'.repeat(64),phone='60123456789';
 async function role(r){await db.exec('reset role');if(r)await db.exec('set role '+r)}
 async function hook(code='012345',p=phone){return (await db.query('select public.e2_aira_send_sms($1::jsonb) v',[JSON.stringify({user:{phone:p},sms:{otp:code}})])).rows[0].v}
 async function worker(action='poll',tok=token,job=null,ok=false){return(await db.query('select public.e2_aira_worker($1,$2,$3,$4) v',[tok,action,job,ok])).rows[0].v}
 for(const r of ['anon','authenticated','service_role']){
  await role(r);await assert.rejects(hook());
  await assert.rejects(db.query('select * from e2_otp_private.jobs'));
 }
 await role('anon');await assert.rejects(worker());
 await role('authenticated');await assert.rejects(worker());
 await role('supabase_auth_admin');assert.equal((await hook()).error.http_code,503);await assert.rejects(worker());
 await role();await db.query("update e2_otp_private.settings set enabled=true,pilot_until=now()+interval '1 day',worker_until=now()+interval '1 day',worker_hash=encode(extensions.digest($1,'sha256'),'hex')",[token]);
 await db.query('insert into e2_otp_private.allowed_phones values($1)',[phone]);
 await role('service_role');await assert.rejects(worker('poll','b'.repeat(64)));assert.deepEqual(await worker(),{});
 await role('supabase_auth_admin');assert.equal((await hook('123456','60123456788')).error.http_code,403);assert.equal((await hook('bad')).error.http_code,400);assert.deepEqual(await hook(),{});
 assert.deepEqual(await hook(),{});
 assert.equal((await hook('654321')).error.http_code,429);
 await role();assert.equal((await db.query('select count(*)::int n from e2_otp_private.jobs')).rows[0].n,1);
 await role('service_role');const job=await worker();assert.equal(job.otp,'012345');assert.deepEqual(await worker(),{});
 await worker('ack',token,job.id,true);
 await role();assert.equal((await db.query('select ciphertext from e2_otp_private.jobs')).rows[0].ciphertext,null);
 await db.exec("update e2_otp_private.jobs set created_at=now()-interval '2 minutes'");
 await role('supabase_auth_admin');assert.deepEqual(await hook('654321'),{});
 await role('service_role');await worker();
 await role();await db.exec("update e2_otp_private.jobs set claimed_at=now()-interval '40 seconds' where state='claimed'");
 await role('service_role');assert.deepEqual(await worker(),{});
 await role();assert.equal((await db.query("select count(*)::int n from e2_otp_private.jobs where ciphertext is not null")).rows[0].n,0);
 await role('service_role');await worker('offline');
 await role('supabase_auth_admin');assert.equal((await hook()).error.http_code,503);
 await role();
 const ids=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004'];
 await db.query("insert into auth.users values($1,now(),null,null,'{}'),($2,null,$5,now(),'{}'),($3,null,$5,null,'{\"phone_verified\":true}'),($4,null,'60123456788',now(),'{}')",[...ids,phone]);
 for(const [i,id] of ids.entries()){await role();await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await role('authenticated');assert.equal((await db.query('select public.e2_customer_allowed() v')).rows[0].v,i<2)}
 await role();await db.query('insert into public.staff_memberships values($1,false)',[ids[1]]);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[1]]);await role('authenticated');assert.equal((await db.query('select public.e2_customer_allowed() v')).rows[0].v,false);
 await role();await db.exec("update e2_otp_private.settings set worker_until=now()-interval '1 second'");
 await role('service_role');await assert.rejects(worker());
 await db.close();
});
