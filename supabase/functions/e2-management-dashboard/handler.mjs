import {malaysiaDate} from './fleet.mjs';
const origins=new Set(['https://e2auto.my','https://bennychow1979.github.io']);
const check=r=>{if(r.error)throw Error('Database read failed');return r.data};
export async function paged(makeQuery) {
  const rows=[];
  for(let offset=0;offset<50000;offset+=500){const batch=check(await makeQuery().range(offset,offset+499));if(!Array.isArray(batch))throw Error('Incomplete result');rows.push(...batch);if(batch.length<500)return rows;}
  throw Error('Result limit exceeded');
}
export function loanSummary(loans,intakes) {
  const groups=[0,0,0,0],seen=new Set();
  for(const [source,rows] of [['loan',loans],['intake',intakes]])for(const row of rows){
    const key=source+':'+row.id;if(seen.has(key))throw Error('Duplicate loan case');seen.add(key);
    const i={'Submitted to E2':0,'Received by Salesman':0,'Needs information':1,'Ready for financier':2,'Sent to Office':2,'Submitted to financier':3}[row.status];
    if(i!==undefined)groups[i]++;
  }
  return {active:groups.reduce((a,b)=>a+b,0),groups};
}
export function createHandler({authenticate,membership,readMembers,readLoans,readCommissions,readFleet,now=()=>new Date()}) {
  return async req=>{
    const origin=req.headers.get('Origin')||'';
    const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',
      'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS',
      ...(origins.has(origin)?{'Access-Control-Allow-Origin':origin}:{})};
    const reply=(status,value)=>new Response(JSON.stringify(value),{status,headers});
    if(origin&&!origins.has(origin))return reply(403,{error:'Origin not allowed'});
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(req.method!=='POST')return reply(405,{error:'Use POST'});
    try {
      const auth=req.headers.get('Authorization')||'';
      if(!auth.startsWith('Bearer '))return reply(401,{error:'Sign in required'});
      const user=await authenticate(auth.slice(7));if(!user)return reply(401,{error:'Sign in required'});
      const staff=await membership(user.id);
      if(staff?.active!==true||staff.role!=='super_admin')return reply(403,{error:'Active Super Admin required'});
      // Authenticate before any business query or workbook download.
      const date=now(),today=malaysiaDate(date),month=today.slice(0,7);
      const jobs={members:()=>readMembers(month+'-01T00:00:00+08:00'),loans:readLoans,commissions:readCommissions,fleet:()=>readFleet(date)};
      const data={asOf:date.toISOString(),today,month,errors:[]};
      await Promise.all(Object.entries(jobs).map(async([key,job])=>{try{data[key]=await job()}catch{data[key]=null;data.errors.push(key)}}));
      return reply(200,data);
    }catch{return reply(503,{error:'Dashboard temporarily unavailable. Sign in again or retry.'})}
  };
}
