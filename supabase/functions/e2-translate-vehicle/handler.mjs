import {translateDescription,TranslationError} from './core.mjs';
export function translationHandler({store,apiKey,model,request}) {
  return async req=>{
    const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
    if(req.method!=='POST')return reply(405,{error:'Use POST'});
    // The database sends a one-use capability. Public visitors never invoke a paid translation.
    if(req.headers.get('Origin'))return reply(403,{error:'Server requests only'});
    const auth=req.headers.get('Authorization')||'';
    if(!/^Bearer e2tr_[a-f0-9]{64}$/.test(auth))return reply(401,{error:'Invalid request'});
    let body;
    try{const raw=await req.text();if(raw.length>400)return reply(413,{error:'Request too large'});body=JSON.parse(raw);}catch{return reply(400,{error:'Invalid request'});}
    if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(body?.vehicle_id||'')||!/^[a-f0-9]{64}$/.test(body?.source_hash||''))return reply(400,{error:'Invalid request'});
    const args={target:body.vehicle_id,source:body.source_hash,token:auth.slice(7)};
    try {
      const job=await store.claim(args);
      if(!job)return reply(409,{error:'Request expired, superseded or already used'});
      let output=null,failure=null;
      try{output=await translateDescription(job.source_text,{apiKey,model,request});}
      catch(error){failure=error instanceof TranslationError?error.code:'upstream_error';}
      const applied=await store.finish({...args,output,failure});
      // No listing text, provider response, token or key is returned to HTTP logs.
      return reply(200,{recorded:applied,status:applied?(failure?'retry_or_review':'ready'):'superseded'});
    }catch{return reply(503,{error:'Translation could not be recorded; the queue will retry'});}
  };
}
