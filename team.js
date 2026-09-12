import {db,configured,check,esc,friendlyError} from './e2-data.js?v=staff-1';
const $=id=>document.getElementById(id);
const labels={super_admin:'Super Admin',admin:'Admin',sales:'Salesman',account:'Account',customer:'Customer'};
const help={super_admin:'Can invite users, change permissions, and manage all vehicles. Give this role only to someone you trust with the whole workspace.',admin:'Can manage vehicles, photos and publication. Cannot manage users or permissions.',sales:'Can view shared inventory, including drafts. Cannot edit vehicles or manage users.',account:'Published stock only. Accounting functions are not available yet.',customer:'Published stock only. Customer account functions are not available yet.'};
let members=[],self=null,editing=null,busy=false,epoch=0;
function note(id,text,error=false){$(id).textContent=text;$(id).classList.toggle('error',error)}
function lock(value){busy=value;document.querySelectorAll('#userForm input,#userForm select,#userForm button').forEach(el=>el.disabled=value);$('closeUser').disabled=value;$('addUser').disabled=value;$('refreshUsers').disabled=value;document.querySelectorAll('[data-user]').forEach(el=>el.disabled=value||el.dataset.user===self)}
function gate(text){epoch++;members=[];self=null;$('userList').replaceChildren();$('teamWorkspace').hidden=true;$('teamGate').hidden=false;$('userDialog').close();note('gateMessage',text)}
function render(){
  $('userList').innerHTML=members.map(m=>'<article class="userRow"><div><strong>'+esc(m.email)+'</strong><small>'+(m.user_id===self?'You · ':'')+(m.email_confirmed?'Email confirmed':'Invitation pending')+'</small></div><span>'+esc(labels[m.role]||m.role)+'</span><span class="userStatus">'+(m.active?'Active':'Inactive')+'</span><button type="button" class="quiet" data-user="'+m.user_id+'" '+(m.user_id===self?'disabled':'')+'>'+(m.user_id===self?'Your account':'Edit access')+'</button></article>').join('');
  document.querySelectorAll('[data-user]').forEach(b=>b.onclick=()=>open(members.find(m=>m.user_id===b.dataset.user)));
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
window.addEventListener('focus',()=>{if(!busy&&!$('userDialog').open)refresh()});
window.addEventListener('beforeunload',e=>{if(busy){e.preventDefault();e.returnValue=''}});
