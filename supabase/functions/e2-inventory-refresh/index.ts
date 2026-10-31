import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {createHandler} from './handler.mjs';
const admin=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false,autoRefreshToken:false}});
const checked=result=>{if(result.error)throw Error('Refresh database operation failed');return result.data};
Deno.serve(createHandler({githubToken:Deno.env.get('E2_INVENTORY_GITHUB_TOKEN'),store:{
 claimDispatch:async(dispatch,token)=>checked(await admin.rpc('e2_claim_inventory_refresh_dispatch',{dispatch,token})),
 claim:async()=>checked(await admin.rpc('e2_claim_inventory_refresh')),
 finish:async(job,outcome,retry_seconds)=>checked(await admin.rpc('e2_finish_inventory_refresh',{lease:job.lease,dispatch:job.dispatch,outcome,retry_seconds}))
}}));
