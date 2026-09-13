import {createClient} from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm';
const config=window.E2_CONFIG||{};
export const customerDB=/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(config.supabaseUrl||'')&&/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey||'')?createClient(config.supabaseUrl,config.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:'e2-customer-auth'}}):null;
export function check(result){if(result.error)throw result.error;return result.data}
export const fields=['full_name','phone','state','city','language','budget_min','budget_max','desired_car','purchase_timeline','payment_preference','trade_in','trade_in_details'];
