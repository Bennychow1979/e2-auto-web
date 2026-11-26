import {readFile} from 'node:fs/promises';
import {homedir,loadavg,availableParallelism} from 'node:os';
import {join,dirname} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {validateJob,validateSender,messageArguments,deliveryAccepted,parseCommandJSON} from './worker-core.mjs';
const publicMode=process.argv.includes('--public');
const cfg=JSON.parse(await readFile(join(homedir(),publicMode?'.config/e2-otp-service/worker.json':'.config/e2-otp-pilot/worker.json'),'utf8'));
if(!/^[0-9a-f]{64}$/.test(cfg.token)||(!publicMode&&!cfg.allowedPhone)||publicMode&&cfg.mode!=='public')throw Error('Invalid worker configuration');
const endpoint=new URL(cfg.endpoint);
if(endpoint.protocol!=='https:'||endpoint.hostname!=='gkppiuuwsecojcnvkzjl.supabase.co'||endpoint.pathname!=='/functions/v1/e2-aira-otp-worker')throw Error('Invalid broker');
const command=join(dirname(process.execPath),'openclaw'),run=promisify(execFile),shutdown=new AbortController();
let stop=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stop=true;shutdown.abort()});
async function checkSender(){
 const claw=JSON.parse(await readFile(join(homedir(),'.openclaw/openclaw.json'),'utf8'));
 const binding=claw.bindings?.find(b=>b.match?.channel==='whatsapp'&&b.match?.accountId===cfg.account);
 if(binding?.agentId!==cfg.agentId)throw Error('Sender mismatch');
 const {stdout}=await run(process.execPath,[command,'channels','status','--json'],{timeout:60000,maxBuffer:1048576,signal:shutdown.signal});
 validateSender(parseCommandJSON(stdout),cfg);
}
async function broker(body){
 const r=await fetch(endpoint,{method:'POST',headers:{'Authorization':'Bearer '+cfg.token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000),redirect:'error'});
 if(!r.ok)throw Error('Broker unavailable');
 return r.json();
}
async function sleep(ms){try{await delay(ms,undefined,{signal:shutdown.signal})}catch{}}
// Independent operator command only; never invoke the AI agent or its tools.
const until=publicMode?Infinity:Date.now()+24*60*60*1000;
let senderChecked=0;
try{
 while(!stop&&Date.now()<until){
  // Yield to AIRA and other server work before starting another CLI process.
  // On Linux, MemAvailable includes reclaimable cache (freemem does not).
  if(publicMode){
   let available=0;
   try{available=Number((await readFile('/proc/meminfo','utf8')).match(/^MemAvailable:\s+(\d+)/m)?.[1]||0)}catch{}
   if(available<384*1024||loadavg()[0]>availableParallelism()*1.5){
    try{await broker({action:'offline'})}catch{}
    await sleep(15000);continue;
   }
  }
  if(Date.now()-senderChecked>300000){
   try{await checkSender();senderChecked=Date.now()}
   catch{process.stderr.write('Confirmed WhatsApp sender unavailable\n');process.exitCode=1;break}
  }
  try{
   const job=validateJob(await broker({action:'poll'}),publicMode?null:cfg.allowedPhone);
   if(job){
    let ok=false,reason='unconfirmed',pulsing=false;
    const heartbeat=publicMode?setInterval(async()=>{
     if(pulsing||stop)return;pulsing=true;
     try{await broker({action:'heartbeat'})}catch{}finally{pulsing=false}
    },7000):null;
    try{
     const {stdout}=await run(process.execPath,[command,...messageArguments(job,cfg.account)],{timeout:60000,maxBuffer:1048576,signal:shutdown.signal});
     ok=deliveryAccepted(parseCommandJSON(stdout));
    }catch(error){reason=error?.killed?'timeout':'command_error'}
    finally{if(heartbeat)clearInterval(heartbeat)}
    // Never retry ambiguous sends. No OTP, recipient or CLI output is logged.
    await broker({action:'ack',job:job.id,ok});
    process.stdout.write(ok?'OTP delivery accepted\n':'OTP delivery '+reason+'\n');
    if(!ok)await sleep(60000);
   }
  }catch{process.stderr.write('OTP broker temporarily unavailable\n');await sleep(10000)}
  await sleep(3000);
 }
}finally{try{await broker({action:'offline'})}catch{}}

