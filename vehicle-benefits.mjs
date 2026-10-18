import {t,language,escapeHTML as esc} from './i18n.mjs';

export const benefitFields=['factory_warranty','factory_warranty_expires','factory_warranty_km','factory_warranty_unlimited','factory_warranty_terms','third_party_warranty','warranty_provider','warranty_package','warranty_months','warranty_km','warranty_unlimited','warranty_price','warranty_coverage','warranty_terms','full_service_record'];
export function malaysiaDay(now=new Date()) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  return ['year','month','day'].map(key=>parts.find(p=>p.type===key).value).join('-');
}
export function factoryWarrantyActive(car,now=new Date()) {
  const date=car.factory_warranty_expires;
  if(car.factory_warranty!==true||typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date<malaysiaDay(now))return false;
  if(car.factory_warranty_unlimited===true)return true;
  return Number.isInteger(car.factory_warranty_km)&&car.factory_warranty_km>0&&car.mileage_confirmed===true&&Number.isInteger(car.mileage)&&car.mileage>=0&&car.mileage<car.factory_warranty_km;
}
export function benefits(car,now=new Date()) {
  const result=[];
  if(factoryWarrantyActive(car,now))result.push(['factory','Factory Warranty']);
  if(['included','available'].includes(car.third_party_warranty)&&car.warranty_provider?.trim()&&car.warranty_package?.trim()&&Number.isInteger(car.warranty_months)&&car.warranty_months>0&&(car.warranty_unlimited===true||(Number.isInteger(car.warranty_km)&&car.warranty_km>0)))result.push([car.third_party_warranty,car.third_party_warranty==='included'?'Warranty Included':'Warranty Available']);
  if(car.full_service_record===true)result.push(['service','Full Service Record']);
  return result;
}
const shield='<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6Z"/>';
export function benefitIcon(kind) {
  const content=kind==='service'?'<path d="M5 3h10l4 4v5M5 3v18h7M15 3v5h4M8 8h3M8 12h6M8 16h3"/><circle cx="18" cy="18" r="4"/><path d="m16 18 1.5 1.5 2.5-3"/>':shield+(kind==='available'?'<path d="M8 12h8M12 8v8"/>':'<path d="m8 12 3 3 5-6"/>');
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+content+'</svg>';
}
export function benefitsHTML(car,{lang=language,now=new Date()}={}) {
  const items=benefits(car,now);
  return items.length?'<span class="vehicleBenefits">'+items.map(([kind,label])=>'<span class="vehicleBadge vehicleBadge--'+kind+'">'+benefitIcon(kind)+'<span>'+esc(t(label,{},lang))+'</span></span>').join('')+'</span>':'';
}
export function benefitDetailsHTML(car,{lang=language,now=new Date()}={}) {
  const items=benefits(car,now),copy=s=>esc(t(s,{},lang));
  if(!items.length)return '';
  const fact=(label,value)=>'<div><dt>'+copy(label)+'</dt><dd>'+esc(value)+'</dd></div>';
  const note=value=>value?'<p class="benefitNote">'+esc(value)+'</p>':'';
  const km=(unlimited,limit)=>unlimited?t('Unlimited mileage',{},lang):Number(limit).toLocaleString('en-MY')+' km';
  let html='';
  if(items.some(([kind])=>kind==='factory'))html+='<article><h3>'+copy('Factory Warranty')+'</h3><dl>'+fact('Expiry date',car.factory_warranty_expires)+fact('Odometer limit',km(car.factory_warranty_unlimited,car.factory_warranty_km))+'</dl><p>'+copy('Ends on the expiry date or at the odometer limit, whichever comes first. Subject to manufacturer terms and transfer eligibility.')+'</p>'+note(car.factory_warranty_terms)+'</article>';
  if(items.some(([kind])=>['included','available'].includes(kind)))html+='<article><h3>'+copy(car.third_party_warranty==='included'?'Warranty Included':'Warranty Available')+'</h3><p>'+copy('Third-party warranty')+'</p><dl>'+fact('Provider',car.warranty_provider)+fact('Package',car.warranty_package)+fact('Duration',t('{count} months',{count:car.warranty_months},lang))+fact('Package mileage allowance',km(car.warranty_unlimited,car.warranty_km))+fact('Package price',car.third_party_warranty==='included'?t('Included in vehicle price',{},lang):car.warranty_price==null?t('Ask for a quote',{},lang):'RM'+Number(car.warranty_price).toLocaleString('en-MY',{minimumFractionDigits:2,maximumFractionDigits:2}))+'</dl>'+note(car.warranty_coverage)+note(car.warranty_terms)+'<p>'+copy('Package availability or inclusion does not mean cover is active. Start date, eligibility, exclusions and claim limits are subject to the provider’s policy.')+'</p></article>';
  if(car.full_service_record===true)html+='<article><h3>'+copy('Full Service Record')+'</h3><p>'+copy('Complete maintenance records checked by E2. This does not mean every service was performed by an authorised service centre.')+'</p></article>';
  return '<h2>'+copy('Warranty & service records')+'</h2><div class="benefitDetailGrid">'+html+'</div>';
}
