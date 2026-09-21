import {readReferral,publicRPC,normalizePhone} from './partner-referral-core.mjs';
export async function setupPartnerReferral(car,getContact){
  const config=window.E2_CONFIG;if(!config?.partnerReferrals)return;
  let storage;try{storage=localStorage}catch{storage={getItem:()=>null,setItem:()=>{}}}
  const code=readReferral(storage,location.search);if(!code)return;
  let visitor;try{visitor=sessionStorage.getItem('e2-ref-visitor');if(!/^[a-f0-9-]{36}$/i.test(visitor||'')){visitor=crypto.randomUUID();sessionStorage.setItem('e2-ref-visitor',visitor)}}catch{visitor=crypto.randomUUID()}
  let partner;
  let lookupFailed=false;
  try{partner=(await publicRPC('e2_track_partner_click',{ref_code:code,car_id:car.id,visitor},config))[0]}catch{lookupFailed=true;partner={display_name:'E2 Partner'}}
  if(!partner){const note=document.createElement('p');note.className='partnerNotice';note.textContent='This referral link is no longer active. You can still contact E2 directly.';document.getElementById('carMain').prepend(note);return}
  const strip=document.createElement('p');strip.className='partnerNotice';
  strip.append(document.createTextNode(lookupFailed?'Referral connection is temporarily unavailable. Save your enquiry to retry. ':'Referred by '+partner.display_name+'. '));
  const leave=document.createElement('button');leave.type='button';leave.textContent='Request a call';strip.append(leave);
  document.getElementById('carMain').prepend(strip);
  const dialog=document.createElement('dialog');dialog.className='partnerEnquiry';
  dialog.setAttribute('aria-labelledby','referralTitle');
  dialog.innerHTML='<form><div class="dialogHeader"><h2 id="referralTitle">Let’s connect.</h2><button type="button" class="close" aria-label="Close enquiry">×</button></div><p>Save your enquiry with E2. No account needed.</p><label>Your name<input name="customer_name" required maxlength="100" autocomplete="name"></label><label>Phone number<input name="customer_phone" type="tel" required maxlength="32" autocomplete="tel" placeholder="012 345 6789"></label><label class="refConsent"><input name="consent" type="checkbox" required> I agree that E2 may save these details and contact me about this enquiry. My referrer sees progress and commission, not my phone or documents.</label><p><a href="partner-privacy.html" target="_blank" rel="noopener">Referral contact notice</a></p><button type="submit" class="pill dark wide">Save enquiry</button><p role="status" aria-live="polite"></p><a class="pill dark wide" data-continue hidden target="_blank" rel="noopener noreferrer">Continue in WhatsApp ↗</a><a data-direct hidden target="_blank" rel="noopener noreferrer">Contact E2 directly without saving this enquiry ↗</a></form>';
  document.body.append(dialog);const form=dialog.querySelector('form'),message=form.querySelector('[role=status]'),next=form.querySelector('[data-continue]'),direct=form.querySelector('[data-direct]');
  let destination=null,source='phone',requestId=null;
  function open(url,kind){
    destination=url;source=kind;requestId=crypto.randomUUID();next.hidden=true;direct.hidden=true;message.textContent='';
    form.reset();form.querySelectorAll('input').forEach(input=>input.disabled=false);
    form.querySelector('button[type=submit]').disabled=false;dialog.showModal();
  }
  leave.onclick=()=>open(null,'phone');dialog.querySelector('.close').onclick=()=>dialog.close();
  const ids=new Set(['enquire','contactWhatsApp','tradeLink','loanLink','financeWhatsApp','bookingLink']);
  document.addEventListener('click',event=>{
    const link=event.target.closest('a');if(!link||!ids.has(link.id)||!link.hasAttribute('href'))return;
    event.preventDefault();event.stopImmediatePropagation();
    if(document.getElementById('bookingDialog').open)document.getElementById('bookingDialog').close();
    open(link.href,link.id==='bookingLink'?'viewing':'whatsapp');
  },true);
  form.onsubmit=async event=>{
    event.preventDefault();const button=form.querySelector('button[type=submit]');button.disabled=true;message.textContent='Saving your enquiry…';
    try{
      const values=new FormData(form),phone=normalizePhone(values.get('customer_phone'));
      await publicRPC('e2_submit_referral',{request_id:requestId,ref_code:code,car_id:car.id,customer_name:values.get('customer_name').trim(),customer_phone:phone,enquiry_source:source,consent:values.get('consent')==='on',sales_id:getContact()?.user_id||null,view_date:source==='viewing'?document.getElementById('viewDate').value:null,view_time:source==='viewing'?document.getElementById('viewTime').value:null},config);
      message.textContent='Enquiry saved. E2 will confirm availability and any viewing time. Reference: '+requestId;
      form.querySelectorAll('input').forEach(input=>input.disabled=true);
      if(destination){const url=new URL(destination);url.searchParams.set('text',(url.searchParams.get('text')||'')+'\n\nEnquiry reference: '+requestId);next.href=url.href;next.hidden=false;next.focus()}
    }catch(error){message.textContent=error.message+' Your enquiry has not been confirmed as saved. Retry with the same reference.';button.disabled=false;if(destination){direct.href=destination;direct.hidden=false}}
  };
}
