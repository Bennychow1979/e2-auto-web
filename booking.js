import {t,language} from './i18n.mjs';
import {normalizePhone,readReferral,publicRPC} from './partner-referral-core.mjs';
import {malaysiaDate,dateLimit,viewingTimes,bookingErrors} from './booking-core.mjs';
const $=id=>document.getElementById(id),form=$('viewingForm'),config=window.E2_CONFIG;
const params=new URLSearchParams(location.search),uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
let storage;try{storage=localStorage}catch{storage={getItem:()=>null,setItem:()=>{}}}
let referral=readReferral(storage,location.search),sales=uuid.test(params.get('sales')||'')?params.get('sales'):null;
const context=[params.get('id')||'',referral||'',sales||''].join('|'),draftKey='e2-viewing-draft';
let requestId=crypto.randomUUID(),lastPayload='',savedReceipt=null,busy=false,draft=null,vehicleLoading=true;
try{const value=JSON.parse(sessionStorage.getItem(draftKey));if(value?.expires>Date.now()&&value.context===context)draft=value;else sessionStorage.removeItem(draftKey)}catch{}
if(draft){requestId=uuid.test(draft.requestId)?draft.requestId:requestId;lastPayload=draft.lastPayload||'';referral=draft.referral;sales=draft.sales;savedReceipt=draft.receipt||null;for(const [key,value] of Object.entries(draft.fields||{})){const field=form.elements.namedItem(key);if(field&&field.type!=='checkbox'&&field.tagName!=='SELECT')field.value=value}form.elements.consent.checked=!!draft.fields?.consent}
if(draft&&!referral){try{storage.removeItem('e2-partner-referral')}catch{}}
function fields(){const result=Object.fromEntries(['customer_name','customer_phone','car_id','view_date','view_time'].map(k=>[k,form.elements.namedItem(k).value]).concat([['consent',form.elements.consent.checked]]));if(vehicleLoading)result.car_id=draft?.fields?.car_id??params.get('id')??'';return result}
function saveDraft(){try{sessionStorage.setItem(draftKey,JSON.stringify({context,expires:Date.now()+30*60*1000,requestId,lastPayload,referral,sales,receipt:savedReceipt,fields:savedReceipt?{}:fields()}))}catch{}}
document.querySelectorAll('[data-language]').forEach(link=>link.addEventListener('click',saveDraft));
function times(selected=$('viewTime').value){$('viewDate').min=malaysiaDate();$('viewDate').max=dateLimit();const values=viewingTimes($('viewDate').value);$('viewTime').replaceChildren(new Option(t(!$('viewDate').value?'Choose a date first':values.length?'Select a time':'No remaining times. Choose another date.'),''),...values.map(v=>new Option(v,v)));if(values.includes(selected))$('viewTime').value=selected}
times(draft?.fields?.view_time);$('viewDate').addEventListener('change',()=>times());
function referralNotice(){$('referralNotice').hidden=!referral;$('referralNotice').textContent=referral?t('Referral code: {code}',{code:referral}):''}
referralNotice();
$('removeReferral').onclick=()=>{referral=null;try{storage.removeItem('e2-partner-referral')}catch{}$('removeReferral').hidden=true;referralNotice();$('formMessage').textContent='';saveDraft()};
$('removeSales').onclick=()=>{sales=null;$('removeSales').hidden=true;$('formMessage').textContent='';saveDraft()};
function receipt(data,label){
  savedReceipt={data,label};form.hidden=true;$('receipt').hidden=false;$('receiptRef').textContent=data.id;
  $('receiptCar').textContent=label||t('General showroom visit');
  const labels={Requested:'Awaiting E2 confirmation',Confirmed:'Appointment confirmed',Completed:'Visit completed',Cancelled:'Request cancelled'};
  $('receiptStatus').textContent=t(labels[data.status]||labels.Requested);
  $('receiptDate').textContent=data.confirmed_date||data.preferred_date;$('receiptTime').textContent=(data.confirmed_time||data.preferred_time).slice(0,5);
  if(data.status!=='Requested'){$('receiptHelp').textContent=t('Your request is saved with E2. Call us with your reference if you need to change it.');$('receiptTitle').textContent=t(labels[data.status]);}
  form.reset();lastPayload='';saveDraft();$('receipt').focus();
}
async function loadVehicles(){
  const rows=[];
  for(let offset=0;;offset+=200){
    const url=new URL(config.supabaseUrl+'/rest/v1/vehicles');url.search=new URLSearchParams({select:'id,year,brand,model,variant',publication:'eq.published',stock_status:'eq.Available',order:'brand,model,id',limit:'200',offset:String(offset)});
    const response=await fetch(url,{headers:{apikey:config.publishableKey},credentials:'omit',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('Inventory unavailable');const batch=await response.json();if(!Array.isArray(batch))throw Error('Inventory unavailable');rows.push(...batch);if(batch.length<200)break;
  }
  const selected=draft?.fields?.car_id??params.get('id');
  $('vehicleChoice').append(...rows.map(c=>new Option([c.year,c.brand,c.model,c.variant].filter(Boolean).join(' '),c.id)));
  if(selected&&rows.some(c=>c.id===selected))$('vehicleChoice').value=selected;
  else if(selected){$('vehicleNotice').hidden=false;$('vehicleNotice').textContent=t(bookingErrors.BOOKING_VEHICLE)}
}
form.onsubmit=async event=>{
  event.preventDefault();if(busy||savedReceipt||!form.reportValidity()||form.elements.website.value)return;
  busy=true;$('submitViewing').disabled=true;$('formMessage').className='';$('formMessage').textContent=t('Submitting your request…');
  try{
    const values=fields(),phone=normalizePhone(values.customer_phone);
    
    const body={customer_name:values.customer_name.trim(),customer_phone:phone,view_date:values.view_date,view_time:values.view_time,consent:values.consent,car_id:values.car_id||null,sales_id:sales,partner_code:referral};
    const signature=JSON.stringify(body);if(signature!==lastPayload&&!viewingTimes(values.view_date).includes(values.view_time))throw Error('BOOKING_TIME');if(lastPayload&&lastPayload!==signature)requestId=crypto.randomUUID();lastPayload=signature;saveDraft();
    const result=await publicRPC('e2_submit_viewing',{request_id:requestId,...body,lang:language},config);
    if(!result||result.id!==requestId||!result.preferred_date||!result.preferred_time)throw Error('Invalid receipt');
    receipt(result,values.car_id?$('vehicleChoice').selectedOptions[0].textContent:'');
  }catch(error){
    const known=bookingErrors[error.message]||(['Enter a valid phone number.','Include your country code, for example +60.'].includes(error.message)?error.message:null);
    $('formMessage').className='error';$('formMessage').textContent=t(known||'We could not confirm that your request was saved. Please retry; the same request will not be saved twice.');
    if(error.message==='BOOKING_REFERENCE'){requestId=crypto.randomUUID();lastPayload='';saveDraft()}
    if(error.message==='BOOKING_REFERRAL')$('removeReferral').hidden=false;
    if(error.message==='BOOKING_SALES')$('removeSales').hidden=false;
    if(error.message==='BOOKING_TIME')times();
  }finally{busy=false;$('submitViewing').disabled=false}
};
if(savedReceipt)receipt(savedReceipt.data,savedReceipt.label);
else{
  try{await loadVehicles()}catch{$('vehicleNotice').hidden=false;$('vehicleNotice').textContent=t('Vehicle list unavailable. You can still request a general showroom visit.')}
  vehicleLoading=false;$('submitViewing').disabled=false;
}
