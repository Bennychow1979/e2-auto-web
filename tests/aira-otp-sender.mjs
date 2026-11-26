import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {senderSettings,sendParameters,deliverWithClient,withGatewayClient} from '../scripts/aira-otp/gateway-sender-core.mjs';
import {runSender} from '../scripts/aira-otp/sender-process.mjs';
const cfg={account:'siti',agentId:'siti',senderPhone:'60122785126',mode:'public'};
const claw={bindings:[{match:{channel:'whatsapp',accountId:'siti'},agentId:'siti'}],gateway:{mode:'local',auth:{mode:'token',token:'synthetic-secret'}}};
const now=Date.now();
const job={id:'00000000-0000-4000-8000-000000000001',phone:'60123456789',otp:'012345',expires_at:new Date(now+180000).toISOString()};
const status={channelAccounts:{whatsapp:[{accountId:'siti',connected:true,self:{e164:'+60122785126'}}]}};
test('local identity is fixed, auth is read-only and scopes do not expand',()=>{
 const s=senderSettings(claw,cfg);
 assert.equal(s.url,'ws://127.0.0.1:18789');assert.equal(s.sharedStateMode,'read-only');
 assert.deepEqual(s.scopes,['operator.read','operator.write']);
 for(const patch of [{account:'default'},{agentId:'other'},{senderPhone:'60123456789'}])assert.throws(()=>senderSettings(claw,{...cfg,...patch}));
 assert.throws(()=>senderSettings({...claw,bindings:[...claw.bindings,...claw.bindings]},cfg));
 for(const patch of [{mode:'remote'},{port:'18789'},{port:0},{auth:{mode:'none'}}])assert.throws(()=>senderSettings({...claw,gateway:{...claw.gateway,...patch}},cfg));
});
test('send checks current sender and expiry before a single explicit-account RPC',async()=>{
 const calls=[];const client={request:async(method,params)=>{calls.push({method,params});return method==='channels.status'?status:{channel:'whatsapp',messageId:'test',toJid:job.phone+'@s.whatsapp.net'}}};
 const r=await deliverWithClient(client,{action:'send',job},cfg,{now:()=>now});
 assert.equal(r.messageId,'test');assert.equal(calls.length,2);
 assert.deepEqual(calls[0],{method:'channels.status',params:{probe:false}});
 assert.equal(calls[1].params.accountId,'siti');assert.equal(calls[1].params.agentId,'siti');
 assert.equal(calls[1].params.idempotencyKey,'e2-otp:'+job.id);
 assert.equal(calls[1].params.to,'+'+job.phone);assert.equal(calls[1].params.sessionKey,undefined);
 calls.length=0;let n=0;
 await assert.rejects(deliverWithClient(client,{action:'send',job},cfg,{now:()=>n++?now+120000:now}));
 assert.equal(calls.length,1,'expired while checking sender: never send');
 assert.throws(()=>sendParameters(job,{...cfg,mode:'pilot',allowedPhone:'60123456788'},now));
});
test('disconnected/wrong sender prevents send; ambiguous outcomes never retry',async()=>{
 for(const account of [{accountId:'siti',connected:false,self:{e164:'+60122785126'}},{accountId:'siti',connected:true,self:{e164:'+60123456788'}}]){
  const calls=[];
  await assert.rejects(deliverWithClient({request:async(m)=>{calls.push(m);return {channelAccounts:{whatsapp:[account]}}}},{action:'send',job},cfg,{now:()=>now}));
  assert.deepEqual(calls,['channels.status']);
 }
 for(const result of [{ok:true},{channel:'whatsapp',messageId:'',error:'failed'},{channel:'telegram',messageId:'test'},{channel:'whatsapp',messageId:'test',toJid:'different@s.whatsapp.net'},new Error('timeout')]){
  let sends=0;
  await assert.rejects(deliverWithClient({request:async(m)=>{if(m==='channels.status')return status;sends++;if(result instanceof Error)throw result;return result}},{action:'send',job},cfg,{now:()=>now}));
  assert.equal(sends,1);
 }
});
test('read-only check never invokes send and connection always closes',async()=>{
 let stopped=0,opts;
 class FakeClient{
  constructor(o){opts=o} start(){queueMicrotask(()=>opts.onHelloOk({}))}
  request(m){assert.equal(m,'channels.status');return status}
  async stopAndWait(){stopped++}
 }
 assert.deepEqual(await withGatewayClient(FakeClient,senderSettings(claw,cfg),c=>deliverWithClient(c,{action:'check'},cfg)),{checked:true});
 assert.equal(stopped,1);assert.equal(opts.sharedStateMode,'read-only');
 class Failure extends FakeClient{start(){queueMicrotask(()=>opts.onConnectError(Error('secret error')))}}
 await assert.rejects(withGatewayClient(Failure,senderSettings(claw,cfg),()=>assert.fail()),{message:'Gateway unavailable'});
 assert.equal(stopped,2);
 class Hanging extends FakeClient{start(){}}
 await assert.rejects(withGatewayClient(Hanging,senderSettings(claw,cfg),()=>assert.fail(),{timeoutMs:5}));
 assert.equal(stopped,3);
});
function fakeSpawn(run){
 return (exe,args,options)=>{
  const c=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();c.stdin=new PassThrough();
  c.kill=()=>{queueMicrotask(()=>c.emit('close',null));return true};
  let input='';c.stdin.on('data',b=>input+=b);c.stdin.on('finish',()=>run(c,{exe,args,options,input}));return c;
 };
}
test('child uses bounded heap and stdin, never puts OTP or phone in argv',async()=>{
 const result=await runSender({action:'send',job},{publicMode:true,spawnProcess:fakeSpawn((c,{args,options,input})=>{
  assert.equal(args.includes('--public'),true);assert.equal(args.includes('--max-old-space-size=80'),true);
  assert.equal(args.join(' ').includes(job.otp),false);assert.equal(args.join(' ').includes(job.phone),false);
  assert.deepEqual(JSON.parse(input),{action:'send',job});assert.equal(options.shell,undefined);
  c.stdout.end('{"checked":true}');c.emit('close',0);
 })});assert.equal(result.stdout,'{"checked":true}');
});
test('child timeout/abort/output flood fail closed without retry or raw errors',async()=>{
 let calls=0;
 await assert.rejects(runSender({action:'check'},{timeoutMs:5,spawnProcess:fakeSpawn(()=>{calls++})}),{message:'Sender unavailable'});assert.equal(calls,1);
 const controller=new AbortController();controller.abort();
 await assert.rejects(runSender({}, {signal:controller.signal,spawnProcess:()=>assert.fail()}));
 await assert.rejects(runSender({}, {spawnProcess:fakeSpawn(c=>c.stdout.write('x'.repeat(20000)))}),{message:'Sender unavailable'});
 await assert.rejects(runSender({}, {spawnProcess:fakeSpawn(c=>{c.stderr.end('OTP secret token');c.emit('close',1)})}),{message:'Sender unavailable'});
});
