import {publicContacts,publicContact,vehiclePageURL} from './referral.js?v=car-share-1';

export function setupCarSharing(car, getContact) {
  const $=id=>document.getElementById(id), dialog=$('shareCarDialog'), picker=$('shareCarContact'), copy=$('copyCarLink');
  let revision=0;
  const render=()=>{
    $('sharedCarURL').value=vehiclePageURL(location.href,car.id,picker.value);
    $('shareCarStatus').textContent='Customer enquiries for this link go to '+picker.selectedOptions[0].textContent+'.';
    copy.textContent='Copy link';
  };
  $('openCarShare').hidden=car.publication!=='published';
  $('openCarShare').onclick=async()=>{
    const run=++revision, current=getContact();
    picker.replaceChildren(new Option('E2 Auto · company WhatsApp',''));
    picker.disabled=true;copy.disabled=true;$('sharedCarURL').value='';
    $('shareCarVehicle').textContent=[car.year,car.brand,car.model,car.variant,'Plate '+car.plate].join(' · ');
    $('shareCarStatus').textContent='Loading contacts…';dialog.showModal();
    try{
      const contacts=await publicContacts(window.E2_CONFIG);
      if(run!==revision)return;
      for(const contact of contacts)picker.add(new Option([contact.display_name,contact.position].filter(Boolean).join(' · '),contact.user_id));
      if(current&&contacts.some(p=>p.user_id===current.user_id))picker.value=current.user_id;
      picker.disabled=false;copy.disabled=false;render();
    }catch(error){
      if(run!==revision)return;
      $('shareCarStatus').textContent=error.message||'Could not load contacts. Close and reopen Share car to retry.';
    }
  };
  $('closeCarShare').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{revision++});
  picker.onchange=render;
  copy.onclick=async()=>{
    const run=revision, staff=picker.value;
    copy.disabled=true;picker.disabled=true;
    try{
      if(staff&&!await publicContact(staff,window.E2_CONFIG)){
        if(run===revision){$('sharedCarURL').value='';$('shareCarStatus').textContent='This contact is no longer available. Choose E2 Auto or another contact.'}
        return;
      }
      if(run!==revision)return;
      const url=vehiclePageURL(location.href,car.id,staff);
      $('sharedCarURL').value=url;
      try{
        await navigator.clipboard.writeText(url);
        if(run===revision){copy.textContent='Copied ✓';$('shareCarStatus').textContent='Link copied. Paste it into your customer chat. Enquiries go to '+picker.selectedOptions[0].textContent+'.'}
      }catch{
        if(run===revision){$('sharedCarURL').focus();$('sharedCarURL').select();$('shareCarStatus').textContent='Press and hold the selected link, then choose Copy.'}
      }
    }finally{if(run===revision){copy.disabled=false;picker.disabled=false}}
  };
}
