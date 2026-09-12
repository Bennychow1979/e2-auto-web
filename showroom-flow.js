// The approved demo's calm, continuous gallery, connected to live inventory.
export function createShowroomFlow(){
  const view=document.getElementById('galleryViewport'),track=document.getElementById('galleryTrack');
  const toggle=document.getElementById('flow'),count=document.getElementById('galleryCount');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let cards=[],active=0,playing=!reduced.matches,hover=false,focused=false,visible=false,pointer=null;
  let last=0,position=null,direction=1,suppressUntil=0,resizeTimer;
  const target=card=>{const r=card.getBoundingClientRect(),v=view.getBoundingClientRect();return view.scrollLeft+r.left+r.width/2-v.left-v.width/2};
  function label(){toggle.textContent=playing?'Pause flow':'Play flow';toggle.setAttribute('aria-pressed',String(playing));}
  function manual(){playing=false;position=null;label()}
  function update(){
    if(!cards.length){count.textContent='—';return}
    let closest=Infinity;
    cards.forEach((card,i)=>{const distance=Math.abs(target(card)-view.scrollLeft);if(distance<closest){closest=distance;active=i}});
    cards.forEach((card,i)=>card.classList.toggle('isActive',i===active));
    count.textContent=String(active+1).padStart(2,'0')+' / '+String(cards.length).padStart(2,'0');
  }
  function center(index,smooth=true){
    if(!cards.length)return;
    active=(index+cards.length)%cards.length;position=null;
    view.scrollTo({left:target(cards[active]),behavior:smooth&&!reduced.matches?'smooth':'instant'});update();
  }
  toggle.onclick=()=>{playing=!playing;position=null;label()};
  document.getElementById('previous').onclick=()=>{manual();center(active-1)};
  document.getElementById('next').onclick=()=>{manual();center(active+1)};
  view.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse')hover=true});
  view.addEventListener('pointerleave',()=>hover=false);
  view.addEventListener('focusin',()=>focused=true);
  view.addEventListener('focusout',e=>{if(!view.contains(e.relatedTarget))focused=false});
  view.addEventListener('scroll',update,{passive:true});
  view.addEventListener('wheel',manual,{passive:true});
  view.addEventListener('pointerdown',e=>{
    if(e.button!==0)return;
    position=null;pointer={id:e.pointerId,x:e.clientX,y:e.clientY,left:view.scrollLeft,drag:false,type:e.pointerType};
  });
  view.addEventListener('pointermove',e=>{
    if(!pointer||pointer.id!==e.pointerId)return;
    const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;
    if(!pointer.drag&&Math.abs(dx)>8&&Math.abs(dx)>Math.abs(dy)){pointer.drag=true;manual();suppressUntil=performance.now()+500}
    if(pointer.type==='mouse'&&pointer.drag){view.classList.add('dragging');view.setPointerCapture(e.pointerId);view.scrollLeft=pointer.left-dx;e.preventDefault()}
  });
  function end(e){
    if(!pointer||pointer.id!==e.pointerId)return;
    if(pointer.drag)suppressUntil=performance.now()+500;
    pointer=null;view.classList.remove('dragging');
    if(view.hasPointerCapture(e.pointerId))view.releasePointerCapture(e.pointerId);
  }
  view.addEventListener('pointerup',end);view.addEventListener('pointercancel',end);view.addEventListener('lostpointercapture',end);window.addEventListener('pointerup',end);
  view.addEventListener('dragstart',e=>e.preventDefault());
  view.addEventListener('click',e=>{if(performance.now()<suppressUntil)e.preventDefault()});
  view.addEventListener('keydown',e=>{if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();manual();center(active+(e.key==='ArrowRight'?1:-1))}});
  reduced.addEventListener('change',()=>{if(reduced.matches)manual()});
  new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;last=0},{threshold:.1}).observe(view);
  document.addEventListener('visibilitychange',()=>{last=0;position=null});
  window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>center(active,false),100)});
  function animate(time){
    const dt=last?Math.min(time-last,40):0;last=time;
    if(cards.length>1&&playing&&!hover&&!focused&&!pointer&&visible&&!document.hidden&&!document.querySelector('dialog[open]')){
      const first=Math.max(0,target(cards[0])),end=Math.min(view.scrollWidth-view.clientWidth,target(cards.at(-1)));
      if(position===null)position=view.scrollLeft;
      if(position>=end-1)direction=-1;if(position<=first+1)direction=1;
      position=Math.max(first,Math.min(end,position+direction*dt*.028));view.scrollLeft=position;
    }else position=null;
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
  return {refresh(){
    const previous=cards[active]?.getAttribute('href');cards=[...track.children];
    const retained=cards.findIndex(card=>card.getAttribute('href')===previous);
    active=retained>=0?retained:Math.min(1,cards.length-1);
    document.querySelector('.galleryControls').hidden=!cards.length;
    [toggle,document.getElementById('previous'),document.getElementById('next')].forEach(button=>button.disabled=cards.length<2);
    if(cards.length<2)playing=false;
    center(active,false);update();label();
  }};
}
