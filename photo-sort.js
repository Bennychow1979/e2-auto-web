// Pointer-based sorting works with mouse, touch and pen without an external library.
export function enablePhotoDrag(grid,{canStart,onActive,onDrop}){
  let drag=null;
  const cards=()=>[...grid.children];
  function restore(order){order.forEach(id=>grid.append(cards().find(card=>card.dataset.photoId===id)))}
  function place(){
    if(!drag)return;
    const items=cards(),rects=items.map(card=>card.getBoundingClientRect());
    const bounds=grid.getBoundingClientRect();
    if(drag.x<bounds.left-24||drag.x>bounds.right+24)return;
    let nearest=0,distance=Infinity;
    rects.forEach((r,i)=>{const d=(drag.x-r.left-r.width/2)**2+(drag.y-r.top-Math.min(r.height,180)/2)**2;if(d<distance){distance=d;nearest=i}});
    const from=items.indexOf(drag.card);
    if(from<nearest)items[nearest].after(drag.card);
    else if(from>nearest)items[nearest].before(drag.card);
  }
  function tick(){
    if(!drag)return;
    const r=drag.editor.getBoundingClientRect(),top=r.top+110,bottom=r.bottom-110;
    const speed=drag.y<top?-Math.min(15,(top-drag.y)/5):drag.y>bottom?Math.min(15,(drag.y-bottom)/5):0;
    if(speed){drag.editor.scrollTop+=speed;place()}
    drag.frame=requestAnimationFrame(tick);
  }
  function finish(cancel=false){
    if(!drag)return;
    const d=drag;drag=null;cancelAnimationFrame(d.frame);
    d.capture.removeEventListener('pointermove',move);
    d.capture.removeEventListener('pointerup',up);
    d.capture.removeEventListener('pointercancel',cancelDrag);
    d.capture.removeEventListener('lostpointercapture',cancelDrag);
    document.removeEventListener('keydown',key,true);
    window.removeEventListener('blur',cancelDrag);
    if(d.capture.hasPointerCapture(d.pointerId))d.capture.releasePointerCapture(d.pointerId);
    d.ghost.remove();d.card.classList.remove('photoDragging');grid.classList.remove('sortingPhotos');
    const order=cards().map(card=>card.dataset.photoId);
    if(cancel)restore(d.order);
    onActive(false);
    if(!cancel&&order.some((id,i)=>id!==d.order[i]))onDrop(order,d.order,d.card.dataset.photoId);
  }
  function move(e){if(!drag||e.pointerId!==drag.pointerId)return;e.preventDefault();drag.x=e.clientX;drag.y=e.clientY;drag.ghost.style.left=(e.clientX-drag.offsetX)+'px';drag.ghost.style.top=(e.clientY-drag.offsetY)+'px';place()}
  function up(e){if(drag&&e.pointerId===drag.pointerId)finish()}
  function cancelDrag(){finish(true)}
  function key(e){if(!drag)return;e.preventDefault();e.stopPropagation();if(e.key==='Escape')finish(true)}
  grid.addEventListener('pointerdown',e=>{
    if(drag||e.button!==0||!e.isPrimary||!canStart())return;
    const card=e.target.closest('[data-photo-id]');
    if(!card)return;
    const handle=card.querySelector('.photoDragHandle');
    if(!handle||handle.disabled||(!e.target.closest('.photoDragHandle')&&!(e.pointerType==='mouse'&&e.target.tagName==='IMG')))return;
    e.preventDefault();
    const rect=card.getBoundingClientRect(),editor=grid.closest('dialog');
    const ghost=card.cloneNode(true);ghost.className='photoDragGhost';ghost.setAttribute('aria-hidden','true');ghost.removeAttribute('data-photo-id');
    ghost.style.cssText=`width:${rect.width}px;left:${rect.left}px;top:${rect.top}px`;
    editor.append(ghost);
    drag={card,handle,capture:grid,editor,ghost,order:cards().map(c=>c.dataset.photoId),pointerId:e.pointerId,x:e.clientX,y:e.clientY,offsetX:e.clientX-rect.left,offsetY:e.clientY-rect.top};
    card.classList.add('photoDragging');grid.classList.add('sortingPhotos');
    onActive(true);grid.setPointerCapture(e.pointerId);
    grid.addEventListener('pointermove',move);grid.addEventListener('pointerup',up);grid.addEventListener('pointercancel',cancelDrag);grid.addEventListener('lostpointercapture',cancelDrag);
    document.addEventListener('keydown',key,true);window.addEventListener('blur',cancelDrag);
    drag.frame=requestAnimationFrame(tick);
  });
  grid.addEventListener('dragstart',e=>e.preventDefault());
}
