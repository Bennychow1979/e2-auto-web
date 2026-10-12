// The readable static heading is the fallback when scripts or observers fail.
const title=document.querySelector('.e2ShinyTitle');
if(title&&typeof window.matchMedia==='function'&&typeof window.IntersectionObserver==='function'){
 try{
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let visible=true;
  const update=()=>{title.dataset.shineRunning=String(visible&&!document.hidden&&!reduced.matches);};
  reduced.addEventListener('change',update);
  document.addEventListener('visibilitychange',update);
  new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;update();}).observe(title);
  update();
 }catch{title.dataset.shineRunning='false';}
}
