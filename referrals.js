import {allRows} from './partner-read.js';
import {db,check} from './e2-data.js?v=partner-1';
import {stages} from './partner-referral-core.mjs';
const $=id=>document.getElementById(id),money=c=>'RM'+(c/100).toFixed(2);
const cell=(row,text)=>{const td=document.createElement('td');if(text!==undefined)td.textContent=text;row.append(td);return td};
function select(options,current,label){const el=document.createElement('select');el.setAttribute('aria-label',label);el.replaceChildren(...options.map(([value,text])=>new Option(text,value)));el.value=current||'';return el}
async function action(button,fn){button.disabled=true;try{await fn();await load();$('message').textContent='Saved.'}catch(error){$('message').textContent=error.message}finally{button.disabled=false}}
let admin=false,accounts=[];
async function load(){
  $('workspace').hidden=true;
  try{
    const {session}=check(await db.auth.getSession());if(!session)throw Error('Sign in through E2 Workspace first.');
    const membership=check(await db.from('staff_memberships').select('role,active').eq('user_id',session.user.id).single());
    if(!membership.active||!['super_admin','admin','sales'].includes(membership.role))throw Error('Active Admin or Sales access required.');
    admin=['admin','super_admin'].includes(membership.role);
    const [leads,partners,cars,requests,staff]=await Promise.all([
      allRows(()=>db.from('e2_referral_leads').select('*').order('created_at',{ascending:false}).order('id')),
      admin?db.rpc('e2_partner_accounts').then(check):db.rpc('e2_referral_partner_labels').then(check),
      allRows(()=>db.from('vehicles').select('id,plate,brand,model').order('id')),
      allRows(()=>db.from('e2_referral_requests').select('id,lead_id,vehicle_id,source,preferred_date,preferred_time,created_at').order('created_at',{ascending:false}).order('id')),
      allRows(()=>db.from('staff_profiles').select('user_id,display_name').order('user_id'))
    ]);
    accounts=admin?partners:[];const selected=$('partnerChoice').value;$('partnerChoice').replaceChildren(new Option('New Partner',''),...accounts.map(p=>new Option(p.display_name,p.id)));$('partnerChoice').value=selected;fillPartner();
    $('partnerAdmin').hidden=!admin;$('commissionAdmin').hidden=!admin;
    $('partners').replaceChildren(...partners.map(p=>{const row=document.createElement('tr');[p.display_name,p.code,money(p.commission_cents),p.active?'Yes':'No'].forEach(v=>cell(row,v));return row}));
    $('leads').replaceChildren(...leads.map(l=>{
      const row=document.createElement('tr');cell(row,l.customer_name+' · +'+l.phone+' · '+l.id);
      const details=cell(row,partners.find(p=>p.id===l.partner_id)?.display_name||l.partner_id);
      for(const r of requests.filter(r=>r.lead_id===l.id).slice(0,5)){const p=document.createElement('p');p.textContent=[r.source,r.preferred_date,r.preferred_time,'Ref '+r.id].filter(Boolean).join(' · ');details.append(p)}
      const vehicle=select(cars.map(c=>[c.id,c.plate+' · '+c.brand+' '+c.model]),l.vehicle_id,'Selected vehicle');cell(row).append(vehicle);
      const choices=[['','Unassigned'],...staff.map(s=>[s.user_id,s.display_name])];if(l.salesperson&&!choices.some(([id])=>id===l.salesperson))choices.push([l.salesperson,l.salesperson]);
      const sales=select(choices,l.salesperson,'Assigned salesperson');sales.disabled=!admin;cell(row).append(sales);
      const controls=cell(row),index=stages.indexOf(l.status),allowed=stages.slice(index,index+2).filter(s=>admin||s!=='Delivered');
      const status=select(allowed.map(s=>[s,s]),l.status,'Lead status');controls.append(status);
      const label=document.createElement('label'),verified=document.createElement('input');verified.type='checkbox';verified.checked=!!l.contact_verified_at;label.append(verified,document.createTextNode('Customer contacted and verified'));controls.append(label);
      const button=document.createElement('button');button.textContent='Save progress';button.disabled=l.status==='Delivered';controls.append(button);
      if(l.status==='Delivered'){vehicle.disabled=true;sales.disabled=true;status.disabled=true;verified.disabled=true}
      button.onclick=()=>action(button,async()=>check(await db.rpc('e2_progress_referral',{target:l.id,next_status:status.value,expected_revision:l.revision,confirm_contact:verified.checked,assigned_sales:sales.value||null,selected_vehicle:vehicle.value})));
      return row;
    }));
    if(admin){const commissions=await allRows(()=>db.from('e2_referral_commissions').select('*').order('created_at',{ascending:false}).order('id'));$('commissions').replaceChildren(...commissions.map(c=>{
      const row=document.createElement('tr');cell(row,c.lead_id+' · '+(partners.find(p=>p.id===c.partner_id)?.display_name||c.partner_id));cell(row,money(c.amount_cents));cell(row,c.status);const controls=cell(row);
      if(c.status==='Paid'){controls.textContent=c.payment_reference;return row}
      const reference=document.createElement('input');reference.placeholder='Actual payment reference';reference.setAttribute('aria-label','Actual payment reference');reference.maxLength=120;reference.hidden=c.status!=='Approved';controls.append(reference);
      const button=document.createElement('button');button.textContent=c.status==='Pending'?'Approve':'Mark paid';controls.append(button);button.onclick=()=>action(button,async()=>check(await db.rpc('e2_pay_referral',{target:c.id,next_status:c.status==='Pending'?'Approved':'Paid',expected_revision:c.revision,reference:reference.value||null})));return row;
    }))}
    $('workspace').hidden=false;$('message').textContent=leads.length?'':'No accessible referral leads yet.';
  }catch(error){$('message').textContent=error.message}
}
function fillPartner(){const p=accounts.find(p=>p.id===$('partnerChoice').value),f=$('partnerForm').elements;f.email.value=p?.email||'';f.email.readOnly=!!p;f.name.value=p?.display_name||'';f.rate.value=p?p.commission_cents/100:'';f.active.checked=p?.active??true;f.revision.value=p?.revision||0}
$('partnerChoice').onchange=fillPartner;
$('partnerForm').onsubmit=event=>{event.preventDefault();const f=new FormData(event.target);action(event.target.querySelector('button'),async()=>{check(await db.rpc('e2_save_partner',{target_email:f.get('email'),partner_name:f.get('name'),rate_cents:Math.round(Number(f.get('rate'))*100),enabled:f.get('active')==='on',expected_revision:Number(f.get('revision'))}));event.target.reset()})};
$('refresh').onclick=load;await load();
