import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {translationHandler} from './handler.mjs';
const admin=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false,autoRefreshToken:false}});
const checked=result=>{if(result.error)throw Error('Database request failed');return result.data;};
Deno.serve(translationHandler({
  apiKey:Deno.env.get('OPENAI_API_KEY'),
  model:Deno.env.get('E2_TRANSLATION_MODEL')||'gpt-4.1-mini-2025-04-14',
  store:{
    claim:async args=>checked(await admin.rpc('e2_claim_vehicle_translation',args)),
    finish:async args=>checked(await admin.rpc('e2_finish_vehicle_translation',args))
  }
}));
