'use strict';
(()=>{
const cars=[{"name":"Toyota RAV4","type":"THE EVERYDAY ESCAPE","year":"2018","price":"RM89,900","img":"https://images.unsplash.com/photo-1615887110697-0819ec23465f?auto=format&fit=crop&w=1400&q=85","pos":"50% 55%","source":"https://unsplash.com/photos/gvMsGzkx8eM","credit":"Vlad Kutepov","desc":"Room for the week. Freedom for the weekend.","slug":"toyota-rav4","make":"Toyota","model":"RAV4","plate":"DEMO01","body":"SUV","spec":"2.0 — sample spec","engine":"2.0 L","transmission":"Auto","fuel":"PETROL","mileage":"72,000 km · sample","priceValue":89900},{"name":"Polestar 2","type":"A QUIETER KIND OF DRIVE","year":"2022","price":"RM168,000","img":"https://images.unsplash.com/photo-1617727553401-3ec4e92f32a5?auto=format&fit=crop&w=1400&q=85","pos":"50% 70%","source":"https://unsplash.com/photos/XwPju3s_79E","credit":"Marcel Strauß","desc":"Clean lines. A different pace.","slug":"polestar-2","make":"Polestar","model":"2","plate":"DEMO02","body":"Fastback","spec":"Electric — sample spec","engine":"0.0 L · Electric","transmission":"Single-speed","fuel":"ELECTRIC","mileage":"32,000 km · sample","priceValue":168000},{"name":"BMW M4","type":"FOR THE LOVE OF DRIVING","year":"2019","price":"RM238,000","img":"https://images.unsplash.com/photo-1614026480209-cd9934144671?auto=format&fit=crop&w=1400&q=85","pos":"50% 50%","source":"https://unsplash.com/photos/1RiyAwNIiew","credit":"Leon Seibert","desc":"A closer look at a driver's car.","slug":"bmw-m4","make":"BMW","model":"M4","plate":"DEMO03","body":"Coupé","spec":"3.0 — sample spec","engine":"3.0 L","transmission":"DCT","fuel":"PETROL","mileage":"58,000 km · sample","priceValue":238000},{"name":"Jeep Grand Cherokee","type":"TAKE THE LONG WAY HOME","year":"2020","price":"RM198,000","img":"https://images.unsplash.com/photo-1616452472872-a7e26d1bb137?auto=format&fit=crop&w=1400&q=85","pos":"50% 70%","source":"https://unsplash.com/photos/o5h_CTIFCkU","credit":"Jakob Rosen","desc":"A little more room to explore.","slug":"jeep-grand-cherokee","make":"Jeep","model":"Grand Cherokee","plate":"DEMO04","body":"SUV","spec":"To confirm","engine":"To confirm","transmission":"Auto","fuel":"To confirm","mileage":"Pending confirmation","priceValue":198000}];
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const slug=new URLSearchParams(location.search).get('car');
const car=cars.find(c=>c.slug===slug)||cars[0];
const rm=(n,digits=0)=>'RM'+n.toLocaleString('en-MY',{minimumFractionDigits:digits,maximumFractionDigits:digits});
const wa=text=>'https://wa.me/60122785126?text='+encodeURIComponent(text);
const intro='Hi E2 Auto, I viewed your '+car.name+' design sample ('+car.plate+', not actual stock). ';
document.title=car.name+' · Vehicle detail preview | E2 Auto';
$('make').textContent=car.make;$('model').textContent=car.model;$('heroEyebrow').textContent=car.year+' · '+car.body+' · DESIGN SAMPLE';
$('heroLine').textContent=car.desc;$('heroPrice').textContent=car.price;$('heroPlate').textContent='PLATE · '+car.plate;
$('heroImage').src=car.img;$('heroImage').alt=car.name+' sample photograph';$('heroImage').style.objectPosition=car.pos;
$('largePhoto').src=car.img;$('largePhoto').alt=car.name+' sample photograph';
$('photoCredit').href=car.source;$('photoCredit').textContent=car.credit+' / Unsplash ↗';
$('story').textContent=car.desc;
const specs=[['Car plate',car.plate],['Year',car.year],['Brand',car.make],['Model',car.model],['Variant / SPEC',car.spec],['Engine size',car.engine],['Transmission',car.transmission],['Fuel type',car.fuel],['Mileage',car.mileage]];
$('specGrid').innerHTML=specs.map(([label,value])=>'<div><dt>'+esc(label)+'</dt><dd>'+esc(value)+'</dd></div>').join('');
$('dockModel').textContent=car.name;$('dockPrice').textContent=car.price;
$('enquire').href=wa(intro+'Please share similar available vehicles and their details.');
$('tradeLink').href=wa(intro+'I would like to discuss a trade-in and the information you need for an inspection.');
$('loanLink').href=wa(intro+'Please explain loan application documents and available terms for a similar real vehicle. I understand approval is subject to assessment.');
$('relatedCars').innerHTML=cars.filter(c=>c.slug!==car.slug).map(c=>'<a class="relatedCard" href="car-detail-demo.html?car='+c.slug+'"><img src="'+esc(c.img)+'" alt="'+esc(c.name)+' sample photo" style="object-position:'+c.pos+'" loading="lazy"><small>'+c.year+' · DESIGN SAMPLE</small><h3>'+esc(c.name)+'</h3><p>'+c.price+' <span aria-hidden="true">↗</span></p></a>').join('');
function calculate(){
const depositPct=Number($('deposit').value),years=Number($('tenure').value),rate=Number($('rate').value);
const valid=$('rate').value.trim()!==''&&$('rate').validity.valid&&rate>=0&&rate<=15;
$('calcError').hidden=valid;
if(!valid){$('monthly').textContent='—';['loan','interest','repayments'].forEach(id=>$(id).textContent='—');$('financeWhatsApp').removeAttribute('href');$('financeWhatsApp').setAttribute('aria-disabled','true');$('monthlyLink').textContent='Adjust your monthly estimate ↗';return}
const deposit=car.priceValue*depositPct/100,loan=car.priceValue-deposit,interest=loan*rate/100*years,total=loan+interest,monthly=total/(years*12);
$('monthly').innerHTML=rm(monthly,2)+'<em>/ month</em>';
$('depositAmount').textContent=rm(deposit);$('depositPercent').textContent=depositPct+'%';$('deposit').setAttribute('aria-valuetext',depositPct+' percent, '+rm(deposit));
$('calcPrice').textContent=car.price;$('loan').textContent=rm(loan,2);$('interest').textContent=rm(interest,2);$('repayments').textContent=rm(total,2);
$('monthlyLink').textContent='Est. '+rm(monthly)+'/mo · adjust estimate ↗';
$('financeWhatsApp').removeAttribute('aria-disabled');$('financeWhatsApp').href=wa(intro+'Illustrative calculation: price '+car.price+', deposit '+rm(deposit)+' ('+depositPct+'%), loan '+rm(loan,2)+', '+years+' years at '+rate+'% p.a. flat, estimated '+rm(monthly,2)+'/month. Please discuss terms for a similar available vehicle. I understand this is not an offer and approval is not guaranteed.');
}
$('calculator').onsubmit=e=>e.preventDefault();['deposit','tenure','rate'].forEach(id=>$(id).addEventListener('input',calculate));calculate();
$('openPhoto').onclick=()=>$('photoDialog').showModal();$('closePhoto').onclick=()=>$('photoDialog').close();
function malaysiaDate(){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const part=k=>parts.find(p=>p.type===k).value;return part('year')+'-'+part('month')+'-'+part('day')}
document.querySelectorAll('[data-book]').forEach(b=>b.onclick=()=>{$('viewDate').min=malaysiaDate();$('bookingDialog').showModal()});
$('closeBooking').onclick=()=>$('bookingDialog').close();
function clearBooking(){ $('bookingReady').hidden=true;$('bookingForm').querySelector('button[type=submit]').hidden=false;$('bookingError').hidden=true;$('bookingLink').removeAttribute('href')}
['viewDate','viewTime'].forEach(id=>$(id).addEventListener('input',clearBooking));
$('bookingForm').onsubmit=e=>{e.preventDefault();const date=$('viewDate').value;if(!date||date<malaysiaDate()){$('bookingError').hidden=false;return}$('bookingLink').href=wa(intro+'I would like a showroom viewing for similar available vehicles. Preferred date: '+date+', '+$('viewTime').value+' (Malaysia time). Please confirm availability, the time and showroom address.');$('bookingReady').hidden=false;$('bookingForm').querySelector('button[type=submit]').hidden=true;$('bookingLink').focus()};
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target!==d)return;const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close()}));
})();
