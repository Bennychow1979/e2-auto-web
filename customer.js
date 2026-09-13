import {pendingSave} from './saved-intent.js';
import {customerDB as db,check,fields} from './customer-data.js?v=customer-1';
import {normalizeWhatsApp} from './profile-utils.js';
const $=id=>document.getElementById(id),profile=$('customerProfile'),register=$('customerRegister'),login=$('customerSignIn');
let user=null,saved=null,busy=false,epoch=0,dirty=false,recovery=false;
try{recovery=sessionStorage.getItem('e2-customer-recovery')==='1'}catch{}
let emailWait=0;try{const n=Number(sessionStorage.getItem('e2-customer-email-wait'));if(n>Date.now()&&n<Date.now()+61000)emailWait=n}catch{}
const redirect=()=>new URL('customer.html',location.href).href;
function note(id,text,bad=false){$(id).textContent=text;$(id).classList.toggle('error',bad)}
function mailControls(){const left=Math.max(0,Math.ceil((emailWait-Date.now())/1000));$('customerForgot').disabled=busy||left>0;$('customerResend').disabled=busy||left>0;$('customerResend').textContent=left?'Try again in '+left+'s':'Resend confirmation';register.querySelector('[type=submit]').disabled=busy||left>0}
function lock(value){busy=value;document.querySelectorAll('form input,form select,form button,#showSignIn,#showRegister,#customerSignOut').forEach(el=>el.disabled=value);mailControls()}
function waitForMail(){emailWait=Date.now()+60000;try{sessionStorage.setItem('e2-customer-email-wait',String(emailWait))}catch{}mailControls()}
setInterval(mailControls,1000);
function mode(create){register.hidden=!create;login.hidden=create;$('showRegister').setAttribute('aria-pressed',String(create));$('showSignIn').setAttribute('aria-pressed',String(!create));note('customerAuthMessage','')}
function gate(){epoch++;user=null;saved=null;dirty=false;profile.reset();$('customerEmail').value='';$('customerAccount').hidden=true;$('customerRecovery').hidden=true;$('customerAuth').hidden=false}
function showRecovery(){epoch++;$('customerAuth').hidden=true;$('customerAccount').hidden=true;$('customerRecovery').hidden=false}
function clearRecovery(){recovery=false;try{sessionStorage.removeItem('e2-customer-recovery')}catch{}}
function fillProfile(){profile.reset();for(const key of fields)profile.elements[key].value=saved?.[key]??(key==='full_name'?user.user_metadata?.full_name||'':key==='phone'?user.user_metadata?.phone||'':'');$('customerEmail').value=user.email;profile.elements.privacy.required=!saved;$('profilePrivacy').hidden=!!saved;dirty=false}
async function hydrate(session){
  const run=++epoch;if(!session){gate();return}if(recovery){showRecovery();return}
  try{
    const result=check(await db.auth.getUser());if(run!==epoch)return;user=result.user;
    if(!user?.email_confirmed_at||!check(await db.rpc('e2_customer_allowed')))throw Error('Confirm your email and sign in with an active account.');
    const row=check(await db.from('customer_profiles').select('*').eq('user_id',user.id).maybeSingle());if(run!==epoch)return;saved=row;
    if(!saved&&user.user_metadata?.e2_customer_signup===true&&user.user_metadata?.privacy_version==='2026-09-13'){
      const initial={full_name:user.user_metadata.full_name,phone:user.user_metadata.phone};
      try{const created=check(await db.rpc('e2_save_customer_profile',{details:initial,expected_revision:0,accept_privacy:true}));if(run!==epoch)return;saved=Array.isArray(created)?created[0]:created}catch{if(run!==epoch)return}
    }
    if(pendingSave()){location.replace('saved.html');return}
    fillProfile();$('customerAuth').hidden=true;$('customerRecovery').hidden=true;$('customerAccount').hidden=false;note('customerProfileMessage',saved?'Your saved details are ready.':'Complete your details to finish setting up your customer profile.');
  }catch(error){if(run===epoch){gate();note('customerAuthMessage',error.message||'Could not load your account. Please try again.',true)}}
}
$('showSignIn').onclick=()=>mode(false);$('showRegister').onclick=()=>mode(true);
login.onsubmit=async event=>{event.preventDefault();if(busy)return;lock(true);note('customerAuthMessage','Signing in…');try{clearRecovery();const result=check(await db.auth.signInWithPassword({email:login.elements.email.value.trim(),password:login.elements.password.value}));login.elements.password.value='';await hydrate(result.session)}catch{note('customerAuthMessage','Could not sign in. Check your email and password, and confirm your email first.',true)}finally{lock(false)}};
register.onsubmit=async event=>{
 event.preventDefault();if(busy||Date.now()<emailWait)return;
 if(register.elements.password.value!==register.elements.confirm.value){note('customerAuthMessage','The passwords do not match.',true);return}
 let phone;try{phone=normalizeWhatsApp(register.elements.phone.value);if(!phone)throw Error('Enter your mobile number.')}catch(e){note('customerAuthMessage',e.message,true);return}
 lock(true);waitForMail();note('customerAuthMessage','Creating your account…');
 try{const email=register.elements.email.value.trim();const result=check(await db.auth.signUp({email,password:register.elements.password.value,options:{emailRedirectTo:redirect(),data:{e2_customer_signup:true,full_name:register.elements.full_name.value.trim(),phone,privacy_version:'2026-09-13'}}}));register.reset();login.elements.email.value=email;mode(false);
 if(result.session)await hydrate(result.session);else note('customerAuthMessage','Check your inbox and Spam / Junk for an E2 confirmation email. Open the newest link, then sign in. If you already have an account, sign in or use Forgot password.');
 }catch(e){note('customerAuthMessage',e.status===429?'Please wait before trying again. Email sending limits may apply.':'Could not complete registration. Please try again, or sign in if you already have an account.',true)}finally{lock(false)}
};
async function requestEmail(type){
 if(busy||Date.now()<emailWait)return;const email=login.elements.email;if(!email.reportValidity())return;
 lock(true);waitForMail();note('customerAuthMessage','Requesting email…');
 try{check(type==='reset'?await db.auth.resetPasswordForEmail(email.value.trim(),{redirectTo:redirect()}):await db.auth.resend({type:'signup',email:email.value.trim(),options:{emailRedirectTo:redirect()}}));note('customerAuthMessage','If this email is eligible, an email has been requested. Check Inbox and Spam / Junk, and use the newest link.')}
 catch{note('customerAuthMessage','The email request could not be completed. Wait and try again, or contact E2.',true)}finally{lock(false)}
}
$('customerForgot').onclick=()=>requestEmail('reset');$('customerResend').onclick=()=>requestEmail('confirm');
$('customerPassword').onsubmit=async event=>{event.preventDefault();if(busy)return;const form=event.currentTarget;if(form.elements.password.value!==form.elements.confirm.value){note('customerRecoveryMessage','The passwords do not match.',true);return}lock(true);try{check(await db.auth.updateUser({password:form.elements.password.value}));form.reset();clearRecovery();check(await db.auth.signOut({scope:'local'}));gate();note('customerAuthMessage','Password saved. Sign in with your new password.')}catch{note('customerRecoveryMessage','Could not save your password. Request a new reset email and try again.',true)}finally{lock(false)}};
profile.oninput=()=>{dirty=true};
profile.onsubmit=async event=>{event.preventDefault();if(busy||!user)return;const run=epoch;lock(true);try{const details=Object.fromEntries(fields.map(k=>[k,profile.elements[k].value.trim()]));details.phone=normalizeWhatsApp(details.phone);const data=check(await db.rpc('e2_save_customer_profile',{details,expected_revision:saved?.revision||0,accept_privacy:profile.elements.privacy.checked}));if(run!==epoch)return;saved=Array.isArray(data)?data[0]:data;fillProfile();note('customerProfileMessage','Your details have been saved.')}catch(e){if(run===epoch)note('customerProfileMessage',e.code==='23514'?'Check your name, phone number and budget range.':e.message||'Could not save your details.',true)}finally{lock(false)}};
$('reloadCustomer').onclick=async()=>{if(busy||(dirty&&!confirm('Discard unsaved changes and reload?')))return;lock(true);try{await hydrate(check(await db.auth.getSession()).session)}finally{lock(false)}};
$('customerSignOut').onclick=async()=>{if(busy||(dirty&&!confirm('Discard unsaved changes and sign out?')))return;lock(true);try{check(await db.auth.signOut({scope:'local'}));clearRecovery();gate()}catch{note('customerProfileMessage','Could not sign out. Please try again.',true)}finally{lock(false)}};
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue=''}});
if(!db){lock(true);note('customerAuthMessage','Customer accounts are being prepared. Please try again later.',true)}else{
 db.auth.onAuthStateChange(event=>{if(event==='PASSWORD_RECOVERY'){recovery=true;try{sessionStorage.setItem('e2-customer-recovery','1')}catch{}showRecovery()}if(event==='SIGNED_OUT'){clearRecovery();gate()}});
 const badLink=new URLSearchParams(location.hash.slice(1)).has('error')||new URLSearchParams(location.search).has('error');
 try{await hydrate(check(await db.auth.getSession()).session)}catch{gate();note('customerAuthMessage','This sign-in link could not be used. Please request a new email.',true)}
 history.replaceState(null,'',location.pathname);
 if(badLink){clearRecovery();gate();note('customerAuthMessage','This email link has expired or was already used. Sign in, resend confirmation, or request a new password reset.',true)}
}
