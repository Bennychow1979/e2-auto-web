// The worker gets no Supabase service key. Only the narrow broker RPC is exposed.
// Do not log request bodies, credentials, phone numbers, OTPs or RPC responses.
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
Deno.serve(async req=>{
 const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
 const fail=(status:number)=>new Response(JSON.stringify({error:'Worker unavailable'}),{status,headers});
 if(req.method!=='POST')return fail(405);
 const token=(req.headers.get('Authorization')||'').replace(/^Bearer /,'');
 if(!/^[0-9a-f]{64}$/.test(token))return fail(401);
 // Bound the stream, not just Content-Length.
 let raw='',size=0;
 const reader=req.body?.getReader();
 if(!reader)return fail(400);
 try{
  const decoder=new TextDecoder();
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1024){await reader.cancel();return fail(413)}raw+=decoder.decode(value,{stream:true})}
  raw+=decoder.decode();
  const body=JSON.parse(raw);
  if(!['poll','ack','offline'].includes(body.action))return fail(400);
  if(body.action==='ack'&&(!/^[0-9a-f-]{36}$/.test(body.job||'')||typeof body.ok!=='boolean'))return fail(400);
  const {data,error}=await db.rpc('e2_aira_worker',{p_token:token,p_action:body.action,p_job:body.action==='ack'?body.job:null,p_ok:body.ok===true});
  if(error)return fail(error.code==='42501'?403:503);
  return new Response(JSON.stringify(data),{headers});
 }catch{return fail(400)}
});
