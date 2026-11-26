export function validateJob(job,allowedPhone,now=Date.now()){
 if(!job||!Object.keys(job).length||job.paused)return null;
 if(!/^[0-9a-f-]{36}$/.test(job.id||'')||(allowedPhone!==null&&job.phone!==allowedPhone)||!/^601[0-9]{8,9}$/.test(job.phone)||!/^\d{6}$/.test(job.otp))throw Error('Invalid job');
 const expiry=Date.parse(job.expires_at);
 if(!Number.isFinite(expiry)||expiry-now<70000||expiry-now>300000)throw Error('Expired job');
 return job;
}
export function validateSender(status,cfg){
 const account=status?.channelAccounts?.whatsapp?.find(a=>a.accountId===cfg.account);
 if(!/^[a-z0-9_-]+$/.test(cfg.account||'')||!/^[a-z0-9_-]+$/.test(cfg.agentId||'')||
  !/^60[1-9][0-9]{7,10}$/.test(cfg.senderPhone||'')||account?.connected!==true||
  account?.self?.e164!=='+'+cfg.senderPhone)throw Error('Confirmed WhatsApp sender unavailable');
 return true;
}
export function messageArguments(job,account){
 if(!/^[a-z0-9_-]+$/.test(account||'')||!/^60[1-9][0-9]{7,10}$/.test(job.phone||'')||!/^\d{6}$/.test(job.otp||''))throw Error('Explicit sender and valid job required');
 const message='E2 Auto 验证码 / Verification code / Kod pengesahan: '+job.otp+'\n仅用于 e2auto.my 注册或登录。请在 5 分钟内使用，勿分享。\nUse within 5 minutes. Do not share this code.\nGunakan dalam 5 minit. Jangan kongsi kod ini.';
 return ['message','send','--channel','whatsapp','--account',account,'--target','+'+job.phone,'--message',message,'--json'];
}
export function deliveryAccepted(result){
 return result?.action==='send'&&result?.channel==='whatsapp'&&result?.dryRun===false&&
  !result?.error&&typeof result?.messageId==='string'&&result.messageId.length>0;
}
// Accept one complete JSON object after optional diagnostic lines.
export function parseCommandJSON(output){
 const raw=String(output||'').trim();
 for(const match of raw.matchAll(/(?:^|\n)\s*(?=\{)/g)){
  try{return JSON.parse(raw.slice(match.index).trim())}catch{}
 }
 throw Error('Command did not return complete JSON');
}
