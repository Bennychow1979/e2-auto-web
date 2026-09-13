import {publicContact,enquiryURL,vehicleShareURL,vehiclePageURL,withVehicleLink} from './referral.js?v=car-share-1';
import {setupCarSharing} from './car-share.js?v=car-share-1';
import {db,check,esc,rm,mileageText,getVehicles,photoURLs,coverURL,friendlyError} from './e2-data.js';
const $=id=>document.getElementById(id);
(async()=>{
try {
const params=new URLSearchParams(location.search), id=params.get('id'), preview=params.get('preview')==='1';
if(!/^[0-9a-f-]{36}$/.test(id||'')) throw new Error('This vehicle link is invalid. Return to the showroom to choose a car.');
if(preview) {
  if(!db) throw new Error('The inventory connection is being prepared.');
  const session=check(await db.auth.getSession()).session;
  if(!session) throw new Error('Sign in to E2 Workspace to preview a draft.');
}
const rows=await getVehicles({id,staff:preview});
if(!rows.length)throw new Error('This vehicle is not currently published or is no longer accessible. Please ask E2 about availability.');
const car=rows[0]; car.name=car.brand+' '+car.model;car.priceValue=Number(car.price);
let contact=await publicContact(params.get('sales'),window.E2_CONFIG);
setupCarSharing(car,()=>contact);
$('applyLoan').hidden=preview||car.stock_status!=='Available';$('applyLoan').href='my-e2.html?car='+encodeURIComponent(car.id)+(contact?'&sales='+encodeURIComponent(contact.user_id):'');
if(!preview)import('./car-save.js?v=saved-1').then(m=>m.setupCarSave(car)).catch(()=>{$('saveCarStatus').textContent='Saved cars are temporarily unavailable. Please reload.'});
const pageLink=()=>vehiclePageURL(location.href,car.id,contact?.user_id);
const wa=(text,previousLink)=>enquiryURL(contact,withVehicleLink(text,pageLink(),previousLink));
const vehicleIntro='I am enquiring about '+car.year+' '+car.name+' '+car.variant+' (Plate '+car.plate+'). ';
let intro='Hi '+(contact?.display_name||'E2 Auto')+', '+vehicleIntro;
async function paintContact(){
  const person=contact;
  $('carContact').hidden=!person;
  $('contactName').textContent=person?.display_name||'E2 Auto';
  $('contactPosition').textContent=person?[person.position,person.languages].filter(Boolean).join(' · '):'Our team is here to help.';
  $('contactPhoto').src='assets/e2-logo.png';
  $('contactProfile').hidden=!person;
  if(person)$('contactProfile').href='consultant.html?id='+encodeURIComponent(person.user_id);
  $('contactWhatsApp').href=wa(intro+'Please confirm availability, price and vehicle details.');
  $('enquire').textContent=person?'WhatsApp ↗':'Ask E2 on WhatsApp ↗';
  $('enquire').setAttribute('aria-label',person?'Contact '+person.display_name+' on WhatsApp':'Ask E2 on WhatsApp');
  if(person?.photo_path){try{const result=await db.storage.from('staff-photos').createSignedUrl(person.photo_path,300);if(contact===person&&!result.error)$('contactPhoto').src=result.data.signedUrl}catch{}}
}
paintContact();
let checkingContact=false;
async function refreshContact(){
  if(checkingContact||!params.get('sales'))return;
  checkingContact=true;
  try{
    const previousIntro=intro, previousLink=pageLink();
    contact=await publicContact(params.get('sales'),window.E2_CONFIG);
    intro='Hi '+(contact?.display_name||'E2 Auto')+', '+vehicleIntro;
    for(const key of ['enquire','tradeLink','loanLink','financeWhatsApp','bookingLink']){
      const link=$(key); if(!link.hasAttribute('href'))continue;
      const text=new URL(link.href).searchParams.get('text')||'';
      link.href=wa(text.startsWith(previousIntro)?intro+text.slice(previousIntro.length):text,previousLink);
    }
    paintContact();
  }finally{checkingContact=false}
}
window.addEventListener('focus',refreshContact);
setInterval(()=>{if(!document.hidden)refreshContact()},60000);
document.title=car.name+' | E2 Auto';
$('make').textContent=car.brand;$('model').textContent=car.model;$('heroEyebrow').textContent=[car.year,car.body_type,car.stock_status].filter(Boolean).join(' · ');
$('heroLine').textContent=car.variant;$('heroPrice').textContent=rm(car.price);$('heroPlate').textContent='PLATE · '+car.plate;
$('story').textContent=car.description||'See the actual vehicle. Ask the questions that matter to you.';
$('publicationNote').textContent=car.publication==='draft'?'PRIVATE DRAFT PREVIEW · Not on the website':car.stock_status;
const specs=[['Car plate',car.plate],['Year',car.year],['Brand',car.brand],['Model',car.model],['Variant / SPEC',car.variant],['Engine size',Number(car.engine_litres).toFixed(1)+' L'],['Transmission',car.transmission],['Fuel type',car.fuel_type],['Mileage',mileageText(car)]];
$('specGrid').innerHTML=specs.map(([label,value])=>'<div><dt>'+esc(label)+'</dt><dd>'+esc(value)+'</dd></div>').join('');
$('dockModel').textContent=car.name;$('dockPrice').textContent=rm(car.price);
$('enquire').href=wa(intro+'Please confirm availability, price and vehicle details.');
$('tradeLink').href=wa(intro+'I would like to discuss a trade-in and the information you need for an inspection.');
$('loanLink').href=wa(intro+'Please explain loan application documents and available terms. I understand approval is subject to assessment.');
let photos=[],photoIndex=0;
function choosePhoto(index){
  if(!photos.length)return;
  photoIndex=(index+photos.length)%photos.length;const p=photos[photoIndex];
  for(const key of ['heroImage','largePhoto']){$(key).src=p.url;$(key).alt=car.name+' · photo '+(photoIndex+1)}
  $('photoPosition').textContent=(photoIndex+1)+' / '+photos.length;
  document.querySelector('.photoCaption>span').textContent='PHOTO '+(photoIndex+1)+' / '+photos.length;
  document.querySelectorAll('#photoThumbs button').forEach((b,i)=>b.setAttribute('aria-pressed',String(i===photoIndex)));
}
async function refreshPhotos(){
  photos=(await photoURLs(car.photos)).filter(p=>p.url);
  $('openPhoto').hidden=!photos.length;
  $('photoCount').textContent=photos.length?photos.length+' vehicle photos · Select a photo to take a closer look.':'No photos available for this draft.';
  $('photoThumbs').innerHTML=photos.map((p,i)=>'<button aria-label="View photo '+(i+1)+'" aria-pressed="false"><img src="'+esc(p.url)+'" alt="" loading="lazy"></button>').join('');
  document.querySelectorAll('#photoThumbs button').forEach((b,i)=>b.onclick=()=>choosePhoto(i));choosePhoto(Math.min(photoIndex,photos.length-1));
}
$('prevPhoto').onclick=()=>choosePhoto(photoIndex-1);$('nextPhoto').onclick=()=>choosePhoto(photoIndex+1);
$('reloadPhotos').onclick=()=>refreshPhotos().catch(error=>$('photoCount').textContent=friendlyError(error));
await refreshPhotos();
let refreshedAt=Date.now();
window.addEventListener('focus',()=>{if(Date.now()-refreshedAt>240000){refreshedAt=Date.now();refreshPhotos().catch(error=>$('photoCount').textContent=friendlyError(error))}});
setInterval(()=>{if(!document.hidden){refreshedAt=Date.now();refreshPhotos().catch(error=>$('photoCount').textContent=friendlyError(error))}},240000);
$('carState').hidden=true;$('carMain').hidden=false;$('carDock').hidden=false;
const related=(await getVehicles().catch(()=>[])).filter(c=>c.id!==car.id).slice(0,3);
$('relatedCars').innerHTML=related.map(c=>'<a class="relatedCard" href="'+esc(contact?vehicleShareURL(location.href,c.id,contact.user_id):'car.html?id='+c.id)+'"><div class="noPhoto" data-related="'+c.id+'">Loading photo…</div><small>'+c.year+' · '+esc(c.stock_status)+'</small><h3>'+esc(c.brand+' '+c.model)+'</h3><p>'+rm(c.price)+' <span aria-hidden="true">↗</span></p></a>').join('');
document.querySelector('.moreCars').hidden=!related.length;
for(const c of related)coverURL(c).then(url=>{const node=document.querySelector('[data-related="'+c.id+'"]');if(url&&node)node.innerHTML='<img src="'+esc(url)+'" alt="'+esc(c.brand+' '+c.model)+'" loading="lazy">'}).catch(()=>{});
function calculate(){
const depositPct=Number($('deposit').value),years=Number($('tenure').value),rate=Number($('rate').value);
const valid=$('rate').value.trim()!==''&&$('rate').validity.valid&&rate>=0&&rate<=15;
$('calcError').hidden=valid;
if(!valid){$('monthly').textContent='—';['loan','interest','repayments'].forEach(id=>$(id).textContent='—');$('financeWhatsApp').removeAttribute('href');$('financeWhatsApp').setAttribute('aria-disabled','true');$('monthlyLink').textContent='Adjust your monthly estimate ↗';return}
const deposit=car.priceValue*depositPct/100,loan=car.priceValue-deposit,interest=loan*rate/100*years,total=loan+interest,monthly=total/(years*12);
$('monthly').innerHTML=rm(monthly,2)+'<em>/ month</em>';
$('depositAmount').textContent=rm(deposit);$('depositPercent').textContent=depositPct+'%';$('deposit').setAttribute('aria-valuetext',depositPct+' percent, '+rm(deposit));
$('calcPrice').textContent=rm(car.price);$('loan').textContent=rm(loan,2);$('interest').textContent=rm(interest,2);$('repayments').textContent=rm(total,2);
$('monthlyLink').textContent='Est. '+rm(monthly)+'/mo · adjust estimate ↗';
$('financeWhatsApp').removeAttribute('aria-disabled');$('financeWhatsApp').href=wa(intro+'Illustrative calculation: price '+rm(car.price)+', deposit '+rm(deposit)+' ('+depositPct+'%), loan '+rm(loan,2)+', '+years+' years at '+rate+'% p.a. flat, estimated '+rm(monthly,2)+'/month. Please discuss available terms for this vehicle. I understand this is not an offer and approval is not guaranteed.');
}
$('calculator').onsubmit=e=>e.preventDefault();['deposit','tenure','rate'].forEach(id=>$(id).addEventListener('input',calculate));calculate();
$('openPhoto').onclick=()=>$('photoDialog').showModal();$('closePhoto').onclick=()=>$('photoDialog').close();
function malaysiaDate(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const part=k=>parts.find(p=>p.type===k).value;return part('year')+'-'+part('month')+'-'+part('day')}
document.querySelectorAll('[data-book]').forEach(b=>b.onclick=()=>{$('viewDate').min=malaysiaDate();$('bookingDialog').showModal()});
$('closeBooking').onclick=()=>$('bookingDialog').close();
function clearBooking(){ $('bookingReady').hidden=true;$('bookingForm').querySelector('button[type=submit]').hidden=false;$('bookingError').hidden=true;$('bookingLink').removeAttribute('href')}
['viewDate','viewTime'].forEach(id=>$(id).addEventListener('input',clearBooking));
$('bookingForm').onsubmit=e=>{e.preventDefault();const date=$('viewDate').value;if(!date||date<malaysiaDate()){$('bookingError').hidden=false;return}$('bookingLink').href=wa(intro+'I would like a viewing of this vehicle. Preferred date: '+date+', '+$('viewTime').value+' (Malaysia time). Please confirm availability, the time and showroom address.');$('bookingReady').hidden=false;$('bookingForm').querySelector('button[type=submit]').hidden=true;$('bookingLink').focus()};
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target!==d)return;const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close()}));
} catch(error) { $('carState').hidden=false;$('carState').textContent=friendlyError(error);$('carMain').hidden=true;$('carDock').hidden=true; }
})();
