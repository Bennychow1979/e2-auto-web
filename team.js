import {db,configured,check,esc,friendlyError} from './e2-data.js?v=staff-1';
const $=id=>document.getElementById(id);
const labels={super_admin:'Super Admin',admin:'Admin',office_admin:'Office Admin',sales:'Salesman',account:'Account',customer:'Customer'};
const help={office_admin:'Can view applications and private documents assigned or handed over to them, and record loan follow-up. Cannot manage vehicles, users or customer profiles.',super_admin:'Can invite users, change permissions, and manage all vehicles. Give this role only to someone you trust with the whole workspace.',admin:'Can manage vehicles, photos and publication. Cannot manage users or permissions.',sales:'Can view shared inventory, including drafts. Cannot edit vehicles or manage users.',account:'Published stock only. Accounting functions are not available yet.',customer:'Published stock and their own customer profile in My E2. No staff inventory management.'};
let members=[],self=null,editing=null,busy=false,epoch=0,resendTarget=null;
const resendWait=new Map();
function note(id,text,error=false){$(id).textContent=text;$(id).classList.toggle('error',error)}
function lock(value){busy=value;document.querySelectorAll('#userForm input,#userForm select,#userForm button,#resendDialog button').forEach(el=>el.disabled=value);$('closeUser').disabled=value;$('addUser').disabled=value;$('refreshUsers').disabled=value;document.querySelectorAll('[data-user]').forEach(el=>el.disabled=value||el.dataset.user===self);updateResendButtons()}
function gate(text){epoch++;members=[];self=null;$('userList').replaceChildren();$('teamWorkspace').hidden=true;$('teamGate').hidden=false;$('userDialog').close();$('resendDialog').close();resendTarget=null;note('gateMessage',text)}
function render(){
  $('userList').innerHTML=members.map(m=>'<article class="userRow"><div><strong>'+esc(m.email)+'</strong><small>'+(m.user_id===self?'You · ':'')+(m.email_confirmed?'Email confirmed':'Invitation pending')+'</small></div><span>'+esc(labels[m.role]||m.role)+'</span><span class="userStatus">'+(m.active?'Active':'Inactive')+'</span><div class="userActions"><button type="button" class="quiet" data-user="'+m.user_id+'" '+(m.user_id===self?'disabled':'')+'>'+(m.user_id===self?'Your account':'Edit access')+'</button>'+(!['customer','office_admin'].includes(m.role)?'<a class="quiet" href="profile.html?user='+m.user_id+'">Edit profile ↗</a>':'')+(m.active&&!m.email_confirmed?'<button type="button" class="quiet" data-resend="'+m.user_id+'">Resend invitation</button>':'')+'</div></article>').join('');
  document.querySelectorAll('[data-user]').forEach(b=>b.onclick=()=>open(members.find(m=>m.user_id===b.dataset.user)));
  document.querySelectorAll('[data-resend]').forEach(b=>b.onclick=()=>openResend(members.find(m=>m.user_id===b.dataset.resend)));updateResendButtons();
}
async function refresh(){
  const request=++epoch;
  try{
    if(!configured)throw Error('Workspace connection is not configured.');
    const session=check(await db.auth.getSession()).session;if(!session){gate('Sign in with your Super Admin account to manage users.');return}
    const rows=check(await db.rpc('e2_list_staff'));if(request!==epoch)return;
    self=session.user.id;members=rows;$('teamEmail').textContent=session.user.email;
    $('teamGate').hidden=true;$('teamWorkspace').hidden=false;render();note('teamMessage',members.length+' users · Changes are saved to E2.');
  }catch(error){if(request===epoch)gate(friendlyError(error))}
}
function details(){
  $('roleHelp').textContent=help[$('userRole').value];
  $('inviteHelp').hidden=!!editing;
  $('inviteHelp').textContent=$('addMethod').value==='invite'?'An invitation email lets this person set their own password. Check the email and role before sending.':'Use this when the person already has an E2 login, or received an invitation whose permissions were not saved. This does not send an email or reset their password.';
  $('saveUser').textContent=editing?'Save permissions':$('addMethod').value==='invite'?'Send invitation ↗':'Add existing account';
}
function open(member=null){
  if(busy)return;editing=member?{...member}:null;$('userForm').reset();
  $('userTitle').textContent=member?'Edit access.':'Add user.';
  $('userEmail').value=member?.email||'';$('userEmail').readOnly=!!member;
  $('methodField').hidden=!!member;$('activeField').hidden=!member;
  $('userRole').value=member?.role||'sales';$('userActive').checked=member?.active??true;
  note('userError','');details();$('userDialog').showModal();
}
$('addUser').onclick=()=>open();$('closeUser').onclick=()=>{if(!busy)$('userDialog').close()};
$('userDialog').addEventListener('cancel',e=>{if(busy)e.preventDefault()});
$('userRole').onchange=details;$('addMethod').onchange=details;$('refreshUsers').onclick=refresh;
$('userForm').onsubmit=async event=>{
  event.preventDefault();if(busy)return;
  const target=editing?{...editing}:null,email=$('userEmail').value.trim(),role=$('userRole').value,active=$('userActive').checked,method=$('addMethod').value;
  lock(true);note('userError',target?'Saving permissions…':method==='invite'?'Sending invitation…':'Adding account…');
  try{
    if(target)check(await db.rpc('e2_update_staff',{target_user:target.user_id,new_role:role,new_active:active,expected_revision:target.revision}));
    else if(method==='existing')check(await db.rpc('e2_add_staff_by_email',{target_email:email,new_role:role}));
    else{
      const result=await db.functions.invoke('e2-invite-user',{body:{action:'invite',email,role}});
      if(result.error){let detail;try{detail=await result.error.context?.json()}catch{}throw Error(detail?.error||'Invitation could not be sent. Check email sending setup and try again.')}
      if(result.data?.error)throw Error(result.data.error);
    }
    $('userDialog').close();await refresh();
    if(self)note('teamMessage',target?'Permissions saved. They apply to the user’s next data request.':method==='invite'?'Invitation sent. The recipient can choose their own password.':'Existing account added.');
  }catch(error){note('userError',friendlyError(error),true)}
  finally{lock(false)}
};
$('teamSignOut').onclick=async()=>{if(busy)return;try{check(await db.auth.signOut());gate('Signed out.')}catch(e){note('teamMessage',friendlyError(e),true)}};
if(configured)db.auth.onAuthStateChange(event=>{if(event==='SIGNED_OUT')gate('Signed out.');});
await refresh();
window.addEventListener('focus',()=>{if(!busy&&!$('userDialog').open&&!$('resendDialog').open)refresh()});
window.addEventListener('beforeunload',e=>{if(busy){e.preventDefault();e.returnValue=''}});

function updateResendButtons(){document.querySelectorAll('[data-resend]').forEach(b=>{const seconds=Math.max(0,Math.ceil(((resendWait.get(b.dataset.resend)||0)-Date.now())/1000));b.disabled=busy||seconds>0;b.textContent=seconds?'Resend in '+seconds+'s':'Resend invitation'})}
setInterval(updateResendButtons,1000);
function openResend(member){
  if(busy||!member?.active||member.email_confirmed||Date.now()<(resendWait.get(member.user_id)||0))return;
  resendTarget={...member};$('resendEmail').textContent=member.email;note('resendError','');$('resendDialog').showModal();
}
$('closeResend').onclick=()=>{if(!busy)$('resendDialog').close()};
$('resendDialog').addEventListener('cancel',e=>{if(busy)e.preventDefault()});
$('resendForm').onsubmit=async event=>{
  event.preventDefault();if(busy||!resendTarget)return;const target={...resendTarget};
  if(Date.now()<(resendWait.get(target.user_id)||0))return;
  resendWait.set(target.user_id,Date.now()+60000);lock(true);note('resendError','Requesting invitation…');
  try{
    const result=await db.functions.invoke('e2-invite-user',{body:{action:'resend',user_id:target.user_id}});
    if(result.error){let detail;try{detail=await result.error.context?.json()}catch{}throw Error(detail?.error||'Invitation could not be resent. Check email sending records before retrying.')}
    if(result.data?.error)throw Error(result.data.error);
    if(!result.data?.resent)throw Error('The invitation service did not confirm this request. Refresh before retrying.');
    $('resendDialog').close();resendTarget=null;await refresh();
    if(self)note('teamMessage','Invitation requested for '+target.email+'. Ask them to check Inbox and Spam / Junk, and use the newest email link. Delivery is not yet confirmed.');
  }catch(error){note('resendError',friendlyError(error),true)}finally{lock(false)}
};
