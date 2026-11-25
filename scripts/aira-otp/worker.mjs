import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,dirname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {validateJob,validateSender,messageRequest,deliveryAccepted} from './worker-core.mjs';
const cfg=JSON.parse(await readFile(join(homedir(),'.config/e2-otp-pilot/worker.json'),'utf8'));
const claw=JSON.parse(await readFile(join(homedir(),'.openclaw/openclaw.json'),'utf8'));
if(!/^[0-9a-f]{64}$/.test(cfg.token)||!cfg.allowedPhone||!claw.gateway?.auth?.token)throw Error('Invalid worker configuration');
const endpoint=new URL(cfg.endpoint);
if(endpoint.protocol!=='https:'||endpoint.hostname!=='gkppiuuwsecojcnvkzjl.supabase.co'||endpoint.pathname!=='/functions/v1/e2-aira-otp-worker')throw Error('Invalid broker');
const gateway='http://127.0.0.1:'+(claw.gateway.port||18789)+'/tools/invoke';
// Read-only startup check: never fall back to a default WhatsApp account.
try{
 const binding=claw.bindings?.find(b=>b.match?.channel==='whatsapp'&&b.match?.accountId===cfg.account);
 if(binding?.agentId!==cfg.agentId)throw Error();
 const {stdout}=await promisify(execFile)(process.execPath,[join(dirname(process.execPath),'openclaw'),'channels','status','--json'],{timeout:60000,maxBuffer:1048576});
 validateSender(JSON.parse(stdout.slice(stdout.indexOf('{'))),cfg);
}catch{process.stderr.write('Confirmed WhatsApp sender unavailable; pilot stopped\n');process.exit(1)}
let stop=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stop=true});
async function broker(body){
 const r=await fetch(endpoint,{method:'POST',headers:{'Authorization':'Bearer '+cfg.token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000),redirect:'error'});
 if(!r.ok)throw Error('Broker unavailable');
 return r.json();
}
const until=Date.now()+24*60*60*1000; // Pilot expires even if accidentally left running.
while(!stop&&Date.now()<until){
 try{
  const job=validateJob(await broker({action:'poll'}),cfg.allowedPhone);
  if(job){
   let ok=false;
   try{
    const r=await fetch(gateway,{method:'POST',headers:{'Authorization':'Bearer '+claw.gateway.auth.token,'Content-Type':'application/json'},body:JSON.stringify(messageRequest(job,cfg.account,cfg.agentId)),signal:AbortSignal.timeout(15000),redirect:'error'});
    ok=r.ok&&deliveryAccepted(await r.json());
   }catch{}
   // Never retry an ambiguous send. An ack failure leaves a claimed job that
   // expires without redelivery. No OTP, phone or gateway response is logged.
   await broker({action:'ack',job:job.id,ok});
   process.stdout.write(ok?'OTP delivery accepted\n':'OTP delivery failed\n');
   if(!ok)await delay(60000);
  }
 }catch{process.stderr.write('OTP worker temporarily unavailable\n');await delay(10000)}
 await delay(3000);
}
try{await broker({action:'offline'})}catch{}
