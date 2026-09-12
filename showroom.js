import {esc,rm,mileageText,getVehicles,photoURLs,friendlyError} from './e2-data.js';
const $=id=>document.getElementById(id), blank={q:'',budget:'',body:'',brand:'',yearFrom:'',yearTo:'',transmission:''};
let cars=[],state={...blank},draft={...blank},flow=false,timer=null;
const advanced=['brand','yearFrom','yearTo','transmission'];
const normalize=s=>String(s).toLowerCase().replace(/\s/g,'');
const matches=(c,s)=>(!s.q||normalize(c.brand+c.model+c.variant+c.plate).includes(normalize(s.q)))&&(!s.budget||Number(c.price)<Number(s.budget))&&(!s.body||c.body_type===s.body)&&(!s.brand||c.brand===s.brand)&&(!s.yearFrom||c.year>=Number(s.yearFrom))&&(!s.yearTo||c.year<=Number(s.yearTo))&&(!s.transmission||c.transmission===s.transmission);
function chipText(k,v){return ({q:'Search: '+v,budget:'Under '+rm(v),body:v,brand:v,yearFrom:'From '+v,yearTo:'To '+v,transmission:v})[k]}
function render(){
  const found=cars.filter(c=>matches(c,state));
  $('filterResults').innerHTML=found.map(c=>'<a class="sampleRow" href="car.html?id='+c.id+'">'+(c.cover?'<img src="'+esc(c.cover)+'" alt="'+esc(c.brand+' '+c.model)+'" loading="lazy">':'<span class="noPhoto">Photo unavailable</span>')+'<span><span class="sampleLabel">'+esc(c.plate+' · '+c.stock_status)+'</span><h3>'+esc(c.brand+' '+c.model)+'</h3><span class="sampleMeta">'+esc(c.year+' · '+c.variant+' · '+c.transmission)+'<br>'+esc(mileageText(c))+'</span></span><span class="rowMoney">'+rm(c.price)+'<small>Selling price</small></span><span class="rowGo" aria-hidden="true">↗</span></a>').join('');
  $('resultCount').textContent=found.length+' '+(found.length===1?'car':'cars')+' to explore';$('emptyResults').hidden=found.length>0||!cars.length;
  $('activeFilters').replaceChildren();
  Object.entries(state).filter(([,v])=>v).forEach(([key,val])=>{const b=document.createElement('button');b.type='button';b.className='filterChip';b.textContent=chipText(key,val)+' ×';b.setAttribute('aria-label','Remove '+chipText(key,val));b.onclick=()=>{state[key]='';sync();render()};$('activeFilters').append(b)});
  $('clearAll').hidden=!Object.values(state).some(Boolean);$('clearSearch').hidden=!state.q;const n=advanced.filter(k=>state[k]).length;$('filterBadge').textContent=n;$('filterBadge').hidden=!n;
}
function sync(){$('carSearch').value=state.q;$('budgetFilter').value=state.budget;$('bodyFilter').value=state.body}
function reset(){state={...blank};sync();render()}
$('searchForm').onsubmit=e=>e.preventDefault();$('carSearch').oninput=e=>{state.q=e.target.value.trim();render()};$('clearSearch').onclick=()=>{state.q='';sync();render();$('carSearch').focus()};$('budgetFilter').onchange=e=>{state.budget=e.target.value;render()};$('bodyFilter').onchange=e=>{state.body=e.target.value;render()};$('clearAll').onclick=reset;$('resetEmpty').onclick=reset;
function preview(){const valid=!draft.yearFrom||!draft.yearTo||Number(draft.yearFrom)<=Number(draft.yearTo);$('yearError').hidden=valid;$('applyFilters').disabled=!valid;$('applyFilters').textContent=valid?'Show '+cars.filter(c=>matches(c,draft)).length+' cars':'Check year range'}
function loadDraft(){advanced.forEach(k=>$('advancedForm').elements.namedItem(k).value=draft[k]);preview()}
$('moreFilters').onclick=()=>{draft={...state};loadDraft();$('filterDialog').showModal()};$('closeFilters').onclick=()=>$('filterDialog').close();$('advancedForm').onchange=e=>{if(advanced.includes(e.target.name)){draft[e.target.name]=e.target.value;preview()}};$('resetAdvanced').onclick=()=>{advanced.forEach(k=>draft[k]='');loadDraft()};$('advancedForm').onsubmit=e=>{e.preventDefault();if($('applyFilters').disabled)return;state={...draft};$('filterDialog').close();sync();render()};
function options(id,values,label){const el=$(id),selected=el.value;el.innerHTML='<option value="">'+label+'</option>'+[...new Set(values.filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true})).map(v=>'<option>'+esc(v)+'</option>').join('');el.value=selected}
function activeIndex(){const track=$('galleryTrack'),nodes=[...track.children];let best=0,distance=Infinity;nodes.forEach((node,i)=>{const d=Math.abs(node.offsetLeft+node.offsetWidth/2-(track.scrollLeft+track.clientWidth/2));if(d<distance){distance=d;best=i}});return best}
function move(delta){const nodes=$('galleryTrack').children;if(!nodes.length)return;nodes[(activeIndex()+delta+nodes.length)%nodes.length].scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'nearest',inline:'center'})}
function stopFlow(){flow=false;clearInterval(timer);$('flow').textContent='Start flow';$('flow').setAttribute('aria-pressed','false')}
$('flow').onclick=()=>{if(flow){stopFlow();return}flow=true;$('flow').textContent='Pause flow';$('flow').setAttribute('aria-pressed','true');timer=setInterval(()=>{if(!document.hidden&&!document.querySelector('dialog[open]'))move(1)},5000)};
$('previous').onclick=()=>{stopFlow();move(-1)};$('next').onclick=()=>{stopFlow();move(1)};$('galleryTrack').onpointerdown=stopFlow;$('galleryTrack').onfocusin=stopFlow;$('galleryTrack').onscroll=()=>{$('galleryCount').textContent=cars.length?(activeIndex()+1)+' / '+Math.min(cars.length,8):'—'};
async function load(){
  try{
    cars=await getVehicles();
    const covers=cars.map(c=>c.photos[0]).filter(Boolean), signed=covers.length?await photoURLs(covers):[], byPath=new Map(signed.map(p=>[p.path,p.url]));
    cars.forEach(c=>c.cover=byPath.get(c.photos[0]?.path));
    $('publicState').hidden=!!cars.length;$('publicState').textContent=cars.length?'':'New vehicles are being prepared. Contact E2 for current availability.';
    $('galleryTrack').innerHTML=cars.slice(0,8).map((c,i)=>'<a class="galleryCard" href="car.html?id='+c.id+'"><span class="cardTop"><span>'+String(i+1).padStart(2,'0')+' / '+esc(c.brand)+'</span><span class="sampleTag">'+esc(c.stock_status)+'</span></span><span class="photo">'+(c.cover?'<img src="'+esc(c.cover)+'" alt="'+esc(c.brand+' '+c.model)+'" '+(i?'loading="lazy"':'fetchpriority="high"')+'>':'<span class="noPhoto">Photo unavailable</span>')+'</span><span class="cardCaption"><span><span class="cardYear">'+esc(c.year+' · '+c.variant)+'</span><strong>'+esc(c.brand+' '+c.model)+'</strong></span><span class="samplePrice">'+rm(c.price)+'<small>View this car ↗</small></span></span></a>').join('');
    document.querySelector('.galleryControls').hidden=!cars.length;$('galleryCount').textContent=cars.length?'1 / '+Math.min(cars.length,8):'—';
    options('brandFilter',cars.map(c=>c.brand),'All brands');options('bodyFilter',cars.map(c=>c.body_type),'All types');options('yearFrom',cars.map(c=>c.year),'Any year');options('yearTo',cars.map(c=>c.year),'Any year');options('transmissionFilter',cars.map(c=>c.transmission),'Any transmission');render();
  }catch(error){$('publicState').hidden=false;$('publicState').textContent=friendlyError(error);$('resultCount').textContent='Inventory temporarily unavailable';$('emptyResults').hidden=true;document.querySelector('.galleryControls').hidden=true;}
}
await load();
// Renew short-lived photo links and stock visibility when the visitor returns.
let loadedAt=Date.now();window.addEventListener('focus',()=>{if(Date.now()-loadedAt>60000){loadedAt=Date.now();load()}});
setInterval(()=>{if(!document.hidden){loadedAt=Date.now();load()}},240000);
