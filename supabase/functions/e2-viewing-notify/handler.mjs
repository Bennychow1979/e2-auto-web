const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const clean=value=>String(value??'').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,' ').trim().slice(0,300);
export function notification(job,channel){
  if(!uuid.test(job.viewing_id))throw Error('Invalid viewing reference');
  return {
    chat_id:channel,
    text:[
      '🚗 E2 AUTO · VIEWING REQUEST',
      'Reference: '+job.viewing_id,
      'Vehicle: '+clean(job.vehicle_label||'General showroom visit'),
      'Customer: '+clean(job.customer_name),
      'Viewing: '+clean(job.date)+' · '+clean(job.time).slice(0,5)+' (Malaysia time)',
      'Assigned Salesman: '+(job.salesperson?clean(job.sales_name):'UNASSIGNED — Admin follow-up required'),
      'Current status: '+clean(job.status),
      'Please check the workspace for the latest assignment and customer details.'
    ].join('\n'),
    protect_content:true,
    link_preview_options:{is_disabled:true},
    reply_markup:{inline_keyboard:[[{text:'View request',url:'https://e2auto.my/bookings.html?viewing='+job.viewing_id}]]}
  };
}
export function createHandler({store,botToken,channel,fetchImpl=fetch,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
  const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  return async req=>{
    if(req.method!=='POST')return reply(405,{error:'Use POST'});
    if(req.headers.get('Origin'))return reply(403,{error:'Scheduled requests only'});
    const auth=req.headers.get('Authorization')||'';
    if(!/^Bearer e2view_[a-f0-9]{64}$/.test(auth))return reply(401,{error:'Invalid dispatch'});
    try{
      const raw=await req.text();if(raw.length>300)return reply(413,{error:'Request too large'});
      let body;try{body=JSON.parse(raw)}catch{return reply(400,{error:'Invalid request'})}
      if(!uuid.test(body?.dispatch_id||''))return reply(400,{error:'Invalid dispatch'});
      if(!await store.claimDispatch(body.dispatch_id,auth.slice(7)))return reply(403,{error:'Dispatch expired or used'});
      if(!/^\d+:[A-Za-z0-9_-]+$/.test(botToken||'')||!/^-[1-9]\d+$/.test(channel||''))return reply(503,{error:'Telegram is not configured'});
      let processed=0;
      for(let i=0;i<8;i++){
        const job=await store.claim();if(!job)break;
        if(job.status==='Cancelled'||job.status==='Completed'){
          await store.finish(job,{outcome:'skipped'});processed++;continue;
        }
        let outcome;
        try{
          const response=await fetchImpl('https://api.telegram.org/bot'+botToken+'/sendMessage',{
            method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(notification(job,channel)),
            signal:AbortSignal.timeout(15000),redirect:'error'
          });
          const data=await response.json();
          if(response.ok&&data.ok===true&&Number.isSafeInteger(data.result?.message_id)&&data.result.message_id>0){
            outcome={outcome:'sent',telegram_message:data.result.message_id};
          }else if(response.status===429||data.error_code===429){
            outcome={outcome:'retry',retry_seconds:Math.max(60,Math.min(86400,Number(data.parameters?.retry_after)||60)),failure_code:'rate_limit'};
          }else if(response.status>=400&&response.status<500){
            outcome={outcome:'failed',failure_code:'telegram_rejected'};
          }else{
            // Network/server ambiguity can mean Telegram accepted the message.
            outcome={outcome:'uncertain',failure_code:'unknown'};
          }
        }catch{
          outcome={outcome:'uncertain',failure_code:'unknown'};
        }
        // Keep the Telegram send outside this persistence call: a DB error must never resend it.
        if(!await store.finish(job,outcome))throw Error('Delivery lease changed');
        processed++;
        if(outcome.outcome!=='sent')break;
        if(i<7)await sleep(1100);
      }
      return reply(200,{processed});
    }catch{
      // No customer data, Bot URL, token or provider response in HTTP responses/logs.
      return reply(500,{error:'Notification worker could not finish'});
    }
  };
}
