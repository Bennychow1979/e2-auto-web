import {createClient} from 'npm:@supabase/supabase-js@2.57.4';
import {createHandler} from './handler.mjs';
const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
Deno.serve(createHandler(admin));
