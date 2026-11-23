import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {createHandler} from './handler.mjs';

const admin = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '', {
  auth:{persistSession:false, autoRefreshToken:false}
});
const checked = result => {
  if (result.error) throw Error('Verification unavailable');
  return result.data;
};
Deno.serve(createHandler({
  key:Deno.env.get('VIEWING_VERIFY_KEY') || '',
  store:{
    takeRateSlot:async () => checked(await admin.rpc('e2_viewing_contact_rate_slot')),
    verify:async (ref, phone) => checked(await admin.rpc('e2_verify_viewing_contact', {target:ref, candidate_phone:phone}))
  }
}));
