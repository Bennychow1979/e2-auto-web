import {allRows} from './partner-read.js';
import {createClient} from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm';
import {partnerLink} from './partner-referral-core.mjs';
const $=id=>document.getElementById(id),config=window.E2_CONFIG;
const db=createClient(config.supabaseUrl,config.publishableKey,{auth:{storageKey:'e2-partner-auth',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const check=r=>{if(r.error)throw r.error;return r.data},money=c=>'RM'+(c/100).toLocaleString('en-MY',{minimumFractionDigits:2});
let partner,recovery=location.hash.includes('type=recovery')||location.hash.includes('type=invite');
async function load(){
  $('dashboard').hidden=true;const {session}=check(await db.auth.getSession());$('auth').hidden=!!session;$('signout').hidden=!session;
  $('recovery').hidden=!recovery;if(recovery||!session)return;
  try{
    partner=check(await db.from('e2_partners').select('*').eq('user_id',session.user.id).single());
    const summary=check(await db.rpc('e2_partner_summary'));
    const commissions=await allRows(()=>db.from('e2_referral_commissions').select('lead_id,amount_cents,status').order('id'));
    const cars=await allRows(()=>db.from('vehicles').select('id,brand,model,plate').eq('publication','published').eq('stock_status','Available').order('created_at',{ascending:false}).order('id'));
    $('partnerName').textContent=partner.display_name;$('code').textContent='Your referral code: '+partner.code+' · Commission per delivered customer: '+money(partner.commission_cents);
    $('clicks').textContent=summary.clicks;$('leadsCount').textContent=summary.leads.length;$('paid').textContent=money(commissions.filter(c=>c.status==='Paid').reduce((sum,c)=>sum+c.amount_cents,0));
    $('cars').replaceChildren(...cars.map(c=>new Option(c.brand+' '+c.model+' · '+c.plate,c.id)));setLink();
    $('leads').replaceChildren(...summary.leads.map(l=>{const row=document.createElement('tr'),c=commissions.find(c=>c.lead_id===l.id);for(const text of [l.id.slice(0,8),new Date(l.created_at).toLocaleDateString(),l.status,c?money(c.amount_cents)+' · '+c.status:'Not yet payable']){const cell=document.createElement('td');cell.textContent=text;row.append(cell)}return row}));
    $('dashboard').hidden=false;$('message').textContent=summary.leads.length?'':'Share your first vehicle link to get started.';
  }catch(error){$('message').textContent='Partner access unavailable. '+error.message}
}
function setLink(){$('link').value=$('cars').value?partnerLink(location.href,$('cars').value,partner.code):'';$('copy').disabled=!$('link').value}
$('cars').onchange=setLink;$('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('link').value);$('message').textContent='Link copied.'}catch{$('link').select();$('message').textContent='Copy the selected link.'}};
$('login').onsubmit=async e=>{e.preventDefault();try{const form=new FormData(e.target);check(await db.auth.signInWithPassword({email:form.get('email'),password:form.get('password')}));HTMLFormElement.prototype.reset.call(e.target);await load()}catch(error){$('message').textContent=error.message}};
$('signout').onclick=async()=>{check(await db.auth.signOut({scope:'local'}));recovery=false;await load()};
$('reset').onclick=async()=>{const email=$('login').elements.email.value;if(!email){$('message').textContent='Enter your email first.';return}try{check(await db.auth.resetPasswordForEmail(email,{redirectTo:new URL('partner.html',location.href).href}));$('message').textContent='If this account is eligible, check your email for the reset link.'}catch(error){$('message').textContent=error.message}};
$('password').onsubmit=async e=>{e.preventDefault();const data=new FormData(e.target);if(data.get('password')!==data.get('confirm')){$('message').textContent='Passwords must match.';return}try{check(await db.auth.updateUser({password:data.get('password')}));recovery=false;history.replaceState(null,'',location.pathname);await load()}catch(error){$('message').textContent=error.message}};
db.auth.onAuthStateChange(event=>{if(event==='PASSWORD_RECOVERY'){recovery=true;$('recovery').hidden=false;$('dashboard').hidden=true}});
await load();
