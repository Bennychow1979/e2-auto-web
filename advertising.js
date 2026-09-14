import {PIXEL,CONSENT_KEY,readChoice,publicURL,safeContext,createTracking} from './advertising-core.js?v=1';
const eligible=safeContext(location.href,document.referrer);
let ownPixel=false,choice=null;
function loadPixel(){
  if(window.fbq)return; // Never attach to another integration's event queue.
  const f=function(){f.callMethod?f.callMethod.apply(f,arguments):f.queue.push(arguments)};
  f.push=f;f.loaded=true;f.version='2.0';f.queue=[];f.disablePushState=true;
  window.fbq=window._fbq=f;ownPixel=true;
  f('consent','grant');f('set','autoConfig',false,PIXEL);f('init',PIXEL);
  const script=document.createElement('script');script.async=true;script.src='https://connect.facebook.net/en_US/fbevents.js';script.referrerPolicy='no-referrer';document.head.append(script);
}
function revokePixel(){if(ownPixel){window.fbq.queue.length=0;window.fbq('consent','revoke')}}
function clearCookies(){for(const name of ['_fbp','_fbc'])for(const domain of ['', '; domain=e2auto.my','; domain=.e2auto.my'])document.cookie=name+'=; Max-Age=0; path=/'+domain+'; SameSite=Lax; Secure'}
const tracker=createTracking({eligible,isCar:location.pathname==='/car.html',load:loadPixel,send:(name,data,custom)=>{if(ownPixel)window.fbq(custom?'trackSingleCustom':'trackSingle',PIXEL,name,data)},revoke:revokePixel});
// Only public vehicle data is accepted. No form values, customer identifiers, WhatsApp text or destination numbers.
export const viewVehicle=car=>tracker.vehicle(car);
if(publicURL(location.href)){
  const panel=document.createElement('section');panel.className='e2CookiePanel';panel.setAttribute('aria-labelledby','e2CookieTitle');panel.setAttribute('role','region');
  panel.innerHTML='<h2 id="e2CookieTitle">Your privacy. Your choice.</h2><p>Allow advertising cookies? Meta Pixel helps us measure vehicle views and WhatsApp clicks, and show relevant ads on Facebook and Instagram. Meta receives browsing events, online identifiers and device / connection information.</p><p class="e2CookieSmall">Optional. You can browse, contact E2 and apply without accepting. <a href="advertising-privacy.html">Advertising privacy</a></p><div class="e2CookieActions"><button type="button" data-choice="no">Reject advertising</button><button type="button" data-choice="yes">Allow advertising</button></div>';
  document.body.append(panel);
  const settings=document.createElement('button');settings.type='button';settings.className='e2CookieSettings';settings.textContent='Cookie settings';(document.querySelector('footer')||document.body).append(settings);
  const stored=()=>{try{return readChoice(localStorage.getItem(CONSENT_KEY))}catch{return null}};
  function apply(value){choice=value;panel.hidden=value!==null;tracker.consent(value===true)}
  function choose(value){try{localStorage.setItem(CONSENT_KEY,JSON.stringify({version:1,allowed:value,at:Date.now()}))}catch{/* Current-page choice still works when browser storage is unavailable. */}
    apply(value);settings.focus();if(!value){clearCookies();if(tracker.started)location.reload()}}
  panel.querySelector('[data-choice="no"]').onclick=()=>choose(false);
  panel.querySelector('[data-choice="yes"]').onclick=()=>choose(true);
  settings.onclick=()=>{panel.hidden=false;panel.querySelector('button').focus()};
  apply(stored());
  document.addEventListener('click',e=>{if(e.defaultPrevented||e.button!==0)return;const a=e.target.closest?.('a');if(a&&a.getAttribute('aria-disabled')!=='true')tracker.contact(a.href)});
  document.addEventListener('change',e=>{if(e.isTrusted&&['deposit','tenure','rate'].includes(e.target.id)&&e.target.closest('#calculator')&&e.target.checkValidity())tracker.calculate()});
  window.addEventListener('storage',e=>{if(e.key!==CONSENT_KEY&&e.key!==null)return;const next=stored();apply(next);if(next!==true&&tracker.started){clearCookies();location.reload()}});
  window.addEventListener('pageshow',e=>{if(e.persisted){const next=stored();if(next!==true&&tracker.started){revokePixel();location.reload()}else apply(next)}});
}
