export const stages=['New Lead','Viewed','Loan Submitted','Approved','Delivered'];
export const validCode=value=>/^[A-Z0-9]{6,24}$/.test(value||'');
export function normalizePhone(value){
  if(!/^\+?[0-9 ()-]+$/.test(value)||value.length>32)throw Error('Enter a valid phone number.');
  let phone=value.replace(/\D/g,'');
  if(phone.startsWith('00'))phone=phone.slice(2);
  if(phone.startsWith('0'))phone='60'+phone.slice(1);
  if(!/^[1-9][0-9]{7,14}$/.test(phone))throw Error('Include your country code, for example +60.');
  return phone;
}
export function partnerLink(base,car,code){
  if(!/^[a-f0-9-]{36}$/i.test(car)||!validCode(code))throw Error('Choose a car and an active Partner.');
  const url=new URL('car.html',base);url.searchParams.set('id',car);url.searchParams.set('ref',code);return url.href;
}
export function readReferral(storage,search,now=Date.now()){
  const incoming=new URLSearchParams(search).get('ref')?.toUpperCase();
  if(incoming){
    if(!validCode(incoming))return null;
    const record={code:incoming,expires:now+30*86400000};
    try{storage.setItem('e2-partner-referral',JSON.stringify(record))}catch{}
    return incoming;
  }
  try{const record=JSON.parse(storage.getItem('e2-partner-referral'));if(validCode(record?.code)&&record.expires>now)return record.code}catch{}
  return null;
}
export async function publicRPC(name,args,config,request=fetch){
  const response=await request(config.supabaseUrl+'/rest/v1/rpc/'+name,{method:'POST',credentials:'omit',headers:{apikey:config.publishableKey,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(15000)});
  const data=await response.json();if(!response.ok)throw Error(data.message||'Unable to save. Please retry.');return data;
}
