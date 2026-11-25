export function validateJob(job,allowedPhone,now=Date.now()){
 if(!job||!Object.keys(job).length||job.paused)return null;
 if(!/^[0-9a-f-]{36}$/.test(job.id||'')||job.phone!==allowedPhone||!/^60[1-9][0-9]{7,10}$/.test(job.phone)||!/^\d{6}$/.test(job.otp))throw Error('Invalid job');
 const expiry=Date.parse(job.expires_at);
 if(!Number.isFinite(expiry)||expiry-now<10000||expiry-now>300000)throw Error('Expired job');
 return job;
}
export function messageRequest(job,account){
 return {tool:'message',action:'send',sessionKey:'agent:main:e2-otp-pilot',args:{channel:'whatsapp',accountId:account,target:'+'+job.phone,message:'E2 Auto 验证码 / Verification code / Kod pengesahan: '+job.otp+'\n仅用于 e2auto.my 注册或登录。请在 5 分钟内使用，勿分享。\nUse within 5 minutes. Do not share this code.\nGunakan dalam 5 minit. Jangan kongsi kod ini.'},idempotencyKey:job.id};
}
export function deliveryAccepted(result){
 if(result?.ok!==true||result.result?.isError===true)return false;
 const value=result.result;
 if(value?.details?.error||value?.error)return false;
 // Tool wrappers may return a JSON text result; require a real message ID.
 const objects=[value?.details,value?.structuredContent,value];
 for(const c of value?.content||[])if(c.type==='text')try{objects.push(JSON.parse(c.text))}catch{}
 return objects.some(v=>typeof v?.messageId==='string'&&v.messageId.length>0);
}
