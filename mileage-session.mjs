import {createClient} from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm';

// A staff-only page reuses the existing same-origin E2 session through the SDK.
// No token is read, copied, displayed, exported or accepted in page parameters.
const config=globalThis.E2_CONFIG||{};
const configured=/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(config.supabaseUrl||'')&&/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey||'');
export const db=configured?createClient(config.supabaseUrl,config.publishableKey,{
 auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storageKey:'e2-staff-auth'}
}):null;
export function check(result){if(result.error)throw result.error;return result.data;}
