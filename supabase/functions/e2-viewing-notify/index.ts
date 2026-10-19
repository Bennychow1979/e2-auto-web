import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {createHandler} from './handler.mjs';
const admin=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{
  auth:{persistSession:false,autoRefreshToken:false}
});
const checked=result=>{if(result.error)throw Error('Notification database operation failed');return result.data};
Deno.serve(createHandler({
  botToken:Deno.env.get('E2_VIEWING_TELEGRAM_BOT_TOKEN'),
  channel:Deno.env.get('E2_VIEWING_TELEGRAM_CHANNEL_ID'),
  store:{
    claimDispatch:async(dispatch,token)=>checked(await admin.rpc('e2_claim_viewing_dispatch',{dispatch,token})),
    claim:async()=>checked(await admin.rpc('e2_claim_viewing_notification')),
    finish:async(job,outcome)=>checked(await admin.rpc('e2_finish_viewing_notification',{
      target:job.viewing_id,lease:job.lease_id,...outcome
    }))
  }
}));
