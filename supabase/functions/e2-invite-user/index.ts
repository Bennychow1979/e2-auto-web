import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
const roles = new Set(['super_admin','admin','sales','account','customer']);
const origins = new Set(['https://e2auto.my','https://bennychow1979.github.io']);
Deno.serve(async (req) => {
  const origin=req.headers.get('Origin')||'';
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',
    'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods':'POST, OPTIONS',...(origins.has(origin)?{'Access-Control-Allow-Origin':origin}:{})};
  const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});
  if(origin&&!origins.has(origin))return reply(403,{error:'Origin not allowed'});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply(405,{error:'Use POST'});
  const authorization=req.headers.get('Authorization')||'';
  if(!authorization.startsWith('Bearer '))return reply(401,{error:'Sign in to continue'});
  try {
    const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if(!url||!anon||!secret)return reply(503,{error:'Invitation service is not configured'});
    const caller=createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
    // Verify with Auth on every request; never trust decoded JWT payloads or browser roles.
    const {data:auth,error:authError}=await caller.auth.getUser(authorization.slice(7));
    if(authError||!auth.user)return reply(401,{error:'Sign in again to continue'});
    const {data:allowed,error:accessError}=await caller.rpc('e2_is_super_admin');
    if(accessError||!allowed)return reply(403,{error:'Super Admin access required'});
    const raw=await req.text();
    if(raw.length>4096)return reply(413,{error:'Request too large'});
    let body;try{body=JSON.parse(raw)}catch{return reply(400,{error:'Invalid request'})}
    if(body.action==='status')return reply(200,{ready:true});
    if(body.action==='resend'){
      if(typeof body.user_id!=='string'||!/^[0-9a-f-]{36}$/i.test(body.user_id))return reply(400,{error:'Choose an existing staff account.'});
      const {data:members,error:listError}=await caller.rpc('e2_list_staff');
      if(listError)return reply(403,{error:'Could not verify staff access'});
      const member=members.find(m=>m.user_id===body.user_id);
      if(!member||!member.active)return reply(409,{error:'This account is missing or inactive. Refresh users before retrying.'});
      const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
      const {data:existing,error:userError}=await admin.auth.admin.getUserById(member.user_id);
      if(userError||!existing?.user||existing.user.email?.toLowerCase()!==member.email.toLowerCase())return reply(409,{error:'This account has changed. Refresh users before retrying.'});
      if(existing.user.email_confirmed_at)return reply(409,{error:'This email is already confirmed. Use Forgot password on the sign-in page.'});
      const {error:limitError}=await caller.rpc('e2_check_invite');
      if(limitError)return reply(429,{error:limitError.message});
      const {data:invited,error:inviteError}=await admin.auth.admin.inviteUserByEmail(member.email,{redirectTo:'https://e2auto.my/accept-invite.html'});
      if(inviteError)return reply(inviteError.status===429?429:400,{error:inviteError.status===429?'Please wait at least 60 seconds before requesting another email. The mail service may also have an hourly limit.':'Invitation could not be resent. Check SMTP sending records and try again. If the account is now confirmed, use Forgot password.'});
      if(invited?.user?.id!==member.user_id)return reply(409,{error:'The account changed during this request. Refresh users before retrying.'});
      return reply(200,{user_id:member.user_id,email:member.email,resent:true});
    }
    const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
    if(body.action!=='invite'||email.length>254||!/^\S+@\S+\.\S+$/.test(email)||!roles.has(body.role))return reply(400,{error:'Enter a valid email and role'});
    const {data:members,error:listError}=await caller.rpc('e2_list_staff');
    if(listError)return reply(403,{error:'Could not verify staff access'});
    if(members.some(m=>m.email.toLowerCase()===email))return reply(409,{error:'This user is already listed. Edit their existing permissions.'});
    const {error:limitError}=await caller.rpc('e2_check_invite');
    if(limitError)return reply(429,{error:limitError.message});
    const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:invited,error:inviteError}=await admin.auth.admin.inviteUserByEmail(email,{redirectTo:'https://e2auto.my/accept-invite.html'});
    if(inviteError)return reply(400,{error:'Invitation could not be sent. Check the email address, SMTP setup and sending limits. Existing accounts can be added with “Add existing account”.'});
    if(!invited.user)return reply(502,{error:'Invitation service returned no user'});
    // This RPC rechecks the caller and will not overwrite an existing membership.
    const {data:userId,error:membershipError}=await caller.rpc('e2_add_staff_by_email',{target_email:email,new_role:body.role});
    if(membershipError)return reply(409,{error:'The invitation was sent but access was not assigned. Refresh Users & permissions and use “Add existing account” for this email.'});
    return reply(200,{user_id:userId,email,role:body.role});
  } catch {
    return reply(500,{error:'Invitation service could not complete the request. Refresh users before retrying.'});
  }
});
