'use strict';
const demoCars=[{"name":"Toyota RAV4","type":"THE EVERYDAY ESCAPE","year":"2018","price":"RM89,900","img":"https://images.unsplash.com/photo-1615887110697-0819ec23465f?auto=format&fit=crop&w=1400&q=85","pos":"50% 55%","source":"https://unsplash.com/photos/gvMsGzkx8eM","credit":"Vlad Kutepov","desc":"Room for the week. Freedom for the weekend."},{"name":"Polestar 2","type":"A QUIETER KIND OF DRIVE","year":"2022","price":"RM168,000","img":"https://images.unsplash.com/photo-1617727553401-3ec4e92f32a5?auto=format&fit=crop&w=1400&q=85","pos":"50% 70%","source":"https://unsplash.com/photos/XwPju3s_79E","credit":"Marcel Strauß","desc":"Clean lines. A different pace."},{"name":"BMW M4","type":"FOR THE LOVE OF DRIVING","year":"2019","price":"RM238,000","img":"https://images.unsplash.com/photo-1614026480209-cd9934144671?auto=format&fit=crop&w=1400&q=85","pos":"50% 50%","source":"https://unsplash.com/photos/1RiyAwNIiew","credit":"Leon Seibert","desc":"A closer look at a driver's car."},{"name":"Jeep Grand Cherokee","type":"TAKE THE LONG WAY HOME","year":"2020","price":"RM198,000","img":"https://images.unsplash.com/photo-1616452472872-a7e26d1bb137?auto=format&fit=crop&w=1400&q=85","pos":"50% 70%","source":"https://unsplash.com/photos/o5h_CTIFCkU","credit":"Jakob Rosen","desc":"A little more room to explore."}];
(()=>{
const view=document.getElementById('galleryViewport'), cards=[...document.querySelectorAll('.galleryCard')], toggle=document.getElementById('flow'), dialog=document.getElementById('vehicleDialog');
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
let active=1,playing=!reduced.matches,hover=false,focus=false,visible=true,interacting=false,pointer=null,suppressUntil=0,last=0,direction=1;
function center(i,smooth=true){active=(i+cards.length)%cards.length;const c=cards[active];view.scrollTo({left:c.offsetLeft-(view.clientWidth-c.offsetWidth)/2,behavior:smooth&&!reduced.matches?'smooth':'instant'});update();}
function update(){const mid=view.scrollLeft+view.clientWidth/2;let distance=Infinity;cards.forEach((c,i)=>{const d=Math.abs(c.offsetLeft+c.offsetWidth/2-mid);if(d<distance){distance=d;active=i}});cards.forEach((c,i)=>c.classList.toggle('isActive',i===active));document.getElementById('galleryCount').textContent=String(active+1).padStart(2,'0')+' / 04';}
function label(){toggle.textContent=playing?'Pause flow':'Play flow';toggle.setAttribute('aria-pressed',String(playing));}
function manual(){playing=false;label();}
toggle.addEventListener('click',()=>{playing=!playing;label();});
document.getElementById('next').addEventListener('click',()=>{manual();center(active+1)});
document.getElementById('previous').addEventListener('click',()=>{manual();center(active-1)});
view.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse')hover=true});
view.addEventListener('pointerleave',()=>{hover=false});
view.addEventListener('focusin',()=>focus=true);
view.addEventListener('focusout',e=>{if(!view.contains(e.relatedTarget))focus=false});
view.addEventListener('scroll',update,{passive:true});
view.addEventListener('wheel',manual,{passive:true});
view.addEventListener('pointerdown',e=>{if(e.button!==0)return;interacting=true;pointer={id:e.pointerId,x:e.clientX,y:e.clientY,left:view.scrollLeft,drag:false,type:e.pointerType};});
view.addEventListener('pointermove',e=>{if(!pointer||pointer.id!==e.pointerId)return;const dx=e.clientX-pointer.x;if(Math.abs(dx)>8){pointer.drag=true;manual();suppressUntil=performance.now()+500;}if(pointer.type==='mouse'&&pointer.drag){view.classList.add('dragging');view.setPointerCapture(e.pointerId);view.scrollLeft=pointer.left-dx;e.preventDefault();}});
function end(e){if(!pointer||pointer.id!==e.pointerId)return;if(pointer.drag)suppressUntil=performance.now()+500;if(view.hasPointerCapture(e.pointerId))view.releasePointerCapture(e.pointerId);pointer=null;interacting=false;view.classList.remove('dragging');}
view.addEventListener('pointerup',end);view.addEventListener('pointercancel',end);
window.addEventListener('pointerup',end);
view.addEventListener('dragstart',e=>e.preventDefault());
view.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();manual();center(active+(e.key==='ArrowRight'?1:-1))}});
cards.forEach((c,i)=>c.addEventListener('click',e=>{if(performance.now()<suppressUntil){e.preventDefault();return;}manual();if(c.dataset.detailHref){location.assign(c.dataset.detailHref);return;}const car=demoCars[i];document.getElementById('dialogTitle').textContent=car.name;document.getElementById('dialogYear').textContent=car.year;document.getElementById('dialogPrice').textContent=car.price;document.getElementById('dialogDescription').textContent=car.desc;const img=document.getElementById('dialogImage');img.src=car.img;img.alt=car.name+' — sample photograph';img.style.objectPosition=car.pos;dialog.showModal();}));
document.getElementById('closeDialog').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
document.addEventListener('visibilitychange',()=>{last=0});
new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;last=0},{threshold:.2}).observe(view);
reduced.addEventListener('change',()=>{if(reduced.matches){playing=false;label();}});
let flowPosition=null;
let resizeTimer;window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>center(active,false),100)});
function animate(t){const dt=last?Math.min(t-last,40):0;last=t;if(playing&&!hover&&!focus&&!interacting&&!dialog.open&&!document.hidden&&visible){const first=cards[0].offsetLeft-(view.clientWidth-cards[0].offsetWidth)/2;const lastCard=cards[cards.length-1];const end=lastCard.offsetLeft-(view.clientWidth-lastCard.offsetWidth)/2;if(view.scrollLeft>=end-1)direction=-1;if(view.scrollLeft<=first+1)direction=1;if(flowPosition===null)flowPosition=view.scrollLeft;flowPosition=Math.max(first,Math.min(end,flowPosition+direction*dt*.028));view.scrollLeft=flowPosition;}else{flowPosition=null;}requestAnimationFrame(animate);}
center(1,false);label();requestAnimationFrame(animate);
})();
