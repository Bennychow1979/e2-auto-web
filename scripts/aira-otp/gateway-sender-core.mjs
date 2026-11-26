import {validateJob,validateSender,messageArguments} from './worker-core.mjs';

// Use only the existing local gateway and the already-authorized CLI identity.
// No remote transport, pairing, credential writes, agent run, or account fallback.
export function senderSettings(claw,cfg){
 const matches=claw.bindings?.filter(b=>b.match?.channel==='whatsapp'&&b.match?.accountId===cfg.account)||[];
 if(matches.length!==1||matches[0].agentId!==cfg.agentId||cfg.account!=='siti'||cfg.agentId!=='siti'||cfg.senderPhone!=='60122785126')throw Error('Sender mismatch');
 const g=claw.gateway,port=g?.port??18789;
 if(g?.mode!=='local'||g?.auth?.mode!=='token'||typeof g.auth.token!=='string'||!g.auth.token.trim()||!Number.isInteger(port)||port<1||port>65535)throw Error('Local gateway unavailable');
 return {url:`ws://127.0.0.1:${port}`,token:g.auth.token,clientName:'cli',mode:'cli',sharedStateMode:'read-only',scopes:['operator.read','operator.write']};
}

export function sendParameters(job,cfg,now=Date.now()){
 if(!validateJob(job,cfg.mode==='public'?null:cfg.allowedPhone,now))throw Error('Job required');
 const args=messageArguments(job,cfg.account);
 return {to:'+'+job.phone,channel:'whatsapp',accountId:cfg.account,agentId:cfg.agentId,message:args[args.indexOf('--message')+1],idempotencyKey:'e2-otp:'+job.id};
}

export async function deliverWithClient(client,request,cfg,{now=Date.now}={}){
 if(request?.action!=='check'&&request?.action!=='send')throw Error('Invalid operation');
 if(request.action==='send')sendParameters(request.job,cfg,now());
 // Inspect only existing channel state; do not initiate a channel probe/reconnect.
 const status=await client.request('channels.status',{probe:false},{timeoutMs:10000});
 validateSender(status,cfg);
 if(request.action==='check')return {checked:true};
 // Recheck expiry after connection/status latency, immediately before sending.
 const params=sendParameters(request.job,cfg,now());
 const result=await client.request('send',params,{timeoutMs:35000});
 if(result?.error||result?.channel!=='whatsapp'||typeof result.messageId!=='string'||!result.messageId.trim())throw Error('Delivery unconfirmed');
 if(result.toJid!==undefined&&result.toJid!==request.job.phone+'@s.whatsapp.net')throw Error('Delivery unconfirmed');
 return {action:'send',channel:'whatsapp',dryRun:false,messageId:result.messageId};
}

export async function withGatewayClient(Client,settings,operation,{timeoutMs=10000}={}){
 let client,timer;
 try{
  await new Promise((resolve,reject)=>{
   const fail=()=>reject(Error('Gateway unavailable'));
   timer=setTimeout(fail,timeoutMs);
   client=new Client({...settings,onHelloOk:resolve,onConnectError:fail,onClose:fail,hostDeps:{logDebug:()=>{},logError:()=>{}}});
   client.start();
  });
  clearTimeout(timer);
  return await operation(client);
 }finally{
  clearTimeout(timer);
  await client?.stopAndWait({timeoutMs:2000});
 }
}
