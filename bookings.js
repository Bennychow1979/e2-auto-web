import {db,check} from './e2-data.js?v=booking-1';
import {allRows} from './partner-read.js';
import {malaysiaDate,dateLimit,viewingTimes} from './booking-core.mjs';
const $=id=>document.getElementById(id);let records=[],staff=[],admin=false,current=null,busy=false;
const add=(parent,tag,text,cls)=>{const node=document.createElement(tag);node.textContent=text;if(cls)node.className=cls;parent.append(node);return node};
function render(){
  const query=$('bookingSearch').value.trim().toLowerCase(),filter=$('statusFilter').value;
  const visible=records.filter(r=>(filter==='all'||(filter==='open'?['Requested','Confirmed'].includes(r.status):r.status===filter))&&[r.id,r.customer_name,r.phone,r.vehicle_label].some(v=>String(v||'').toLowerCase().includes(query)));
  $('bookingCount').textContent=visible.length+' requests · '+records.filter(r=>r.status==='Requested').length+' awaiting confirmation';
  $('bookingList').replaceChildren(...visible.map(r=>{
    const row=document.createElement('article');row.className='viewingRow';row.dataset.status=r.status;
    const person=document.createElement('div');row.append(person);add(person,'span',r.status,'viewingStatus');add(person,'h2',r.customer_name);const phone=add(person,'a','+'+r.phone);phone.href='tel:+'+r.phone;add(person,'p',r.vehicle_label||'General showroom visit');add(person,'small',r.id);
    const visit=document.createElement('div');row.append(visit);add(visit,'p',(r.confirmed_date?'Agreed: ':'Requested: ')+(r.confirmed_date||r.preferred_date)+' · '+(r.confirmed_time||r.preferred_time).slice(0,5));add(visit,'p','Language: '+({en:'English',ms:'Bahasa Melayu',zh:'华语'}[r.locale]));add(visit,'p','Sales: '+(r.salesperson?(staff.find(s=>s.user_id===r.salesperson)?.display_name||r.salesperson):'Unassigned'));
    const button=add(row,'button','Manage');button.type='button';button.onclick=()=>open(r);return row;
  }));
}
async function load(){
  $('refresh').disabled=true;
  try{
    if(!db)throw Error('The E2 connection is unavailable.');const {session}=check(await db.auth.getSession());if(!session)throw Error('Sign in through E2 Workspace first.');
    const membership=check(await db.from('staff_memberships').select('role,active').eq('user_id',session.user.id).single());
    if(!membership.active||!['super_admin','admin','sales'].includes(membership.role))throw Error('Active Admin or Sales access required.');
    admin=['super_admin','admin'].includes(membership.role);
    [records,staff]=await Promise.all([allRows(()=>db.from('e2_viewings').select('id,customer_name,phone,vehicle_label,preferred_date,preferred_time,locale,salesperson,ref_code,referral_request_id,status,confirmed_date,confirmed_time,contact_verified_at,staff_note,revision,created_at').order('created_at',{ascending:false}).order('id')),allRows(()=>db.from('staff_profiles').select('user_id,display_name').order('user_id'))]);
    if(admin)staff=check(await db.rpc('e2_viewing_assignees'));
    $('workspace').hidden=false;$('message').textContent=admin?'All viewing requests. Unassigned requests need an E2 administrator to follow up.':'Only requests assigned to you are shown.';render();
  }catch(error){records=[];$('workspace').hidden=true;$('bookingList').replaceChildren();$('message').textContent=error.message}
  finally{$('refresh').disabled=false}
}
function fillTimes(selected=$('confirmedTime').value){
  const values=viewingTimes($('confirmedDate').value);$('confirmedTime').replaceChildren(new Option('Select a time',''),...values.map(v=>new Option(v,v)));
  if(selected&&current?.confirmed_date===$('confirmedDate').value&&current?.confirmed_time?.slice(0,5)===selected&&!values.includes(selected))$('confirmedTime').append(new Option(selected,selected));
  $('confirmedTime').value=selected||'';
}
function confirmation(){const show=$('editStatus').value==='Confirmed';$('confirmationFields').hidden=!show;$('confirmedDate').required=show;$('confirmedTime').required=show;$('confirmedContact').required=show;for(const id of ['confirmedDate','confirmedTime','confirmedContact'])$(id).disabled=!show}
function open(row){
  current=row;$('editForm').reset();$('editMessage').textContent='';$('customerDetails').textContent=row.customer_name+' · +'+row.phone;$('callCustomer').href='tel:+'+row.phone;
  $('requestDetails').textContent=[row.id,row.vehicle_label||'General showroom visit','Requested: '+row.preferred_date+' '+row.preferred_time.slice(0,5)+' (Malaysia time)',row.ref_code?'Referral: '+row.ref_code+(row.referral_request_id?' · recorded in Partners & referrals':' · general visit; follow up with the Partner when a car is chosen'):''].filter(Boolean).join('\n');
  const choices={Requested:['Requested','Confirmed','Cancelled'],Confirmed:['Confirmed','Completed','Cancelled'],Completed:['Completed'],Cancelled:['Cancelled']};
  $('editStatus').replaceChildren(...choices[row.status].map(s=>new Option(s,s)));$('editStatus').value=row.status;
  const people=[...staff];if(row.salesperson&&!people.some(s=>s.user_id===row.salesperson))people.push({user_id:row.salesperson,display_name:row.salesperson});
  $('editSales').replaceChildren(new Option('Unassigned',''),...people.map(s=>new Option(s.display_name,s.user_id)));$('editSales').value=row.salesperson||'';$('editSales').disabled=!admin;
  $('confirmedDate').min=row.confirmed_date||malaysiaDate();$('confirmedDate').max=dateLimit();$('confirmedDate').value=row.confirmed_date||row.preferred_date;fillTimes((row.confirmed_time||row.preferred_time).slice(0,5));$('confirmedContact').checked=!!row.contact_verified_at;$('staffNote').value=row.staff_note;confirmation();$('bookingEditor').showModal();
}
$('confirmedDate').onchange=()=>{fillTimes();$('confirmedContact').checked=false};$('confirmedTime').onchange=()=>{$('confirmedContact').checked=false};$('editStatus').onchange=confirmation;
$('closeEditor').onclick=()=>{if(!busy)$('bookingEditor').close()};$('bookingEditor').addEventListener('cancel',e=>{if(busy)e.preventDefault()});
$('editForm').onsubmit=async e=>{
  e.preventDefault();if(busy||!current||!$('editForm').reportValidity())return;busy=true;$('saveBooking').disabled=true;$('editMessage').textContent='Saving…';
  try{
    check(await db.rpc('e2_update_viewing',{target:current.id,expected_revision:current.revision,next_status:$('editStatus').value,assigned_sales:$('editSales').value||null,confirmed_day:$('confirmedDate').value||null,confirmed_slot:$('confirmedTime').value||null,confirm_contact:$('confirmedContact').checked,note:$('staffNote').value}));
    $('bookingEditor').close();await load();$('message').textContent='Appointment saved. No message was sent automatically.';
  }catch(error){$('editMessage').textContent=error.message}
  finally{busy=false;$('saveBooking').disabled=false}
};
$('refresh').onclick=load;$('statusFilter').onchange=render;$('bookingSearch').oninput=render;
await load();
