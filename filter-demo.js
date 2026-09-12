'use strict';
(()=>{
const extra=[
{brand:'Toyota',body:'SUV',plate:'DEMO01',mileage:72000,transmission:'Auto'},
{brand:'Polestar',body:'Fastback',plate:'DEMO02',mileage:32000,transmission:'Auto'},
{brand:'BMW',body:'Coupé',plate:'DEMO03',mileage:58000,transmission:'Auto'},
{brand:'Jeep',body:'SUV',plate:'DEMO04',mileage:null,transmission:'Auto'}];
const cars=demoCars.map((c,i)=>({...c,...extra[i],id:i,priceValue:Number(c.price.replace(/\D/g,'')),year:Number(c.year)}));
const blank={q:'',budget:'',body:'',brand:'',yearFrom:'',yearTo:'',transmission:''};
let state={...blank},draft={...blank};
const byId=id=>document.getElementById(id), modal=byId('filterDialog'), form=byId('advancedForm');
const advanced=['brand','yearFrom','yearTo' ,'transmission'];
const normalize=s=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
function matches(c,s){return (!s.q||normalize(c.brand+' '+c.name+' '+c.plate).includes(normalize(s.q)))&&(!s.budget||c.priceValue<Number(s.budget))&&(!s.body||c.body===s.body)&&(!s.brand||c.brand===s.brand)&&(!s.yearFrom||c.year>=Number(s.yearFrom))&&(!s.yearTo||c.year<=Number(s.yearTo))&&(!s.transmission||c.transmission===s.transmission);}
function chipText(k,v){return ({q:'Search: '+v,budget:'Under RM'+Number(v).toLocaleString('en-MY'),body:v,brand:v,yearFrom:'From '+v,yearTo:'To '+v,transmission:v})[k];}
function render(){
const found=cars.filter(c=>matches(c,state));const results=byId('filterResults');results.replaceChildren();
found.forEach(c=>{const row=document.createElement('button');row.type='button';row.className='sampleRow';row.setAttribute('aria-label','Open '+c.name+' sample details from results');
const photo=document.createElement('img');photo.src=c.img;photo.alt='';photo.style.objectPosition=c.pos;photo.loading='lazy';
const info=document.createElement('span');info.innerHTML='<span class="sampleLabel">SAMPLE · '+c.plate+'</span><h3>'+c.name+'</h3><span class="sampleMeta">'+c.year+' · '+c.body+' · '+c.transmission+'<br>'+(c.mileage===null?'Mileage pending confirmation':c.mileage.toLocaleString('en-MY')+' km · sample mileage')+'</span>';
const price=document.createElement('span');price.className='rowMoney';price.innerHTML=c.price+'<small>Illustrative price</small>';const arrow=document.createElement('span');arrow.className='rowGo';arrow.textContent='↗';arrow.setAttribute('aria-hidden','true');row.append(photo,info,price,arrow);row.addEventListener('click',()=>document.querySelector('.galleryCard[data-car="'+c.id+'"]').click());results.append(row)});
byId('resultCount').textContent=found.length+' '+(found.length===1?'car':'cars')+' to explore';
byId('emptyResults').hidden=found.length>0;
const chips=byId('activeFilters');chips.replaceChildren();Object.entries(state).filter(([,v])=>v).forEach(([key,val])=>{const b=document.createElement('button');b.type='button';b.className='filterChip';b.textContent=chipText(key,val);b.setAttribute('aria-label','Remove '+chipText(key,val));const x=document.createElement('span');x.textContent='×';b.append(x);b.onclick=()=>{state[key]='';sync();render()};chips.append(b)});
byId('clearAll').hidden=!Object.values(state).some(Boolean);byId('clearSearch').hidden=!state.q;
const n=advanced.filter(k=>state[k]).length;byId('filterBadge').textContent=n;byId('filterBadge').hidden=!n;
}
function sync(){byId('carSearch').value=state.q;byId('budgetFilter').value=state.budget;byId('bodyFilter').value=state.body;}
byId('searchForm').onsubmit=e=>e.preventDefault();
byId('carSearch').addEventListener('input',e=>{state.q=e.target.value.trim();render()});
byId('clearSearch').onclick=()=>{state.q='';sync();render();byId('carSearch').focus()};
byId('budgetFilter').onchange=e=>{state.budget=e.target.value;render()};
byId('bodyFilter').onchange=e=>{state.body=e.target.value;render()};
function reset(){state={...blank};sync();render()}
byId('clearAll').onclick=reset;byId('resetEmpty').onclick=reset;
function loadDraft(){advanced.forEach(k=>form.elements.namedItem(k).value=draft[k]);preview();}
function preview(){const valid=!draft.yearFrom||!draft.yearTo||Number(draft.yearFrom)<=Number(draft.yearTo);byId('yearError').hidden=valid;const submit=byId('applyFilters');submit.disabled=!valid;const n=cars.filter(c=>matches(c,draft)).length;submit.textContent=valid?'Show '+n+' '+(n===1?'car':'cars'):'Check year range';}
byId('moreFilters').onclick=()=>{draft={...state};loadDraft();modal.showModal()};
byId('closeFilters').onclick=()=>modal.close();
form.addEventListener('change',e=>{if(advanced.includes(e.target.name)){draft[e.target.name]=e.target.value;preview()}});
byId('resetAdvanced').onclick=()=>{advanced.forEach(k=>draft[k]='');loadDraft()};
form.onsubmit=e=>{e.preventDefault();if(byId('applyFilters').disabled)return;state={...draft};modal.close();sync();render();};
modal.addEventListener('click',e=>{if(e.target===modal){const r=modal.getBoundingClientRect();if(e.clientX<r.left||e.clientY<r.top)modal.close()}});
render();
})();
