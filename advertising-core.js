export const PIXEL='1050984971227179', CONSENT_KEY='e2-advertising-v1', MAX_AGE=180*86400000;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Fail closed on private pages, preview links, auth fragments and unexpected parameters.
export function publicURL(value){
  try{const u=new URL(value);if(u.origin!=='https://e2auto.my'||!['/','/index.html','/showroom.html','/car.html'].includes(u.pathname))return false;
    if(u.hash&&!/^#(?:top|cars|gallery|visit|specs|finance)$/.test(u.hash))return false;
    for(const [key,v] of u.searchParams){
      if(['id','sales'].includes(key)){if(!uuid.test(v))return false}
      else if(key==='fbclid'){if(!/^[A-Za-z0-9_-]{1,500}$/.test(v))return false}
      else if(['utm_source','utm_medium','utm_campaign','utm_content','utm_term','update'].includes(key)){if(!/^[A-Za-z0-9_. -]{1,150}$/.test(v))return false}
      else return false;
    }
    return u.pathname!=='/car.html'||uuid.test(u.searchParams.get('id')||'');
  }catch{return false}
}
export function safeContext(href,referrer=''){
  if(!publicURL(href))return false;
  if(!referrer)return true;
  try{const r=new URL(referrer);return r.origin==='https://e2auto.my'?publicURL(r.href):!r.search&&!r.hash}catch{return false}
}
export function readChoice(raw,now=Date.now()){
  try{const v=JSON.parse(raw);return v.version===1&&typeof v.allowed==='boolean'&&Number.isFinite(v.at)&&v.at<=now&&now-v.at<MAX_AGE?v.allowed:null}catch{return null}
}
export function whatsapp(value){try{const u=new URL(value);return u.protocol==='https:'&&['wa.me','whatsapp.com','www.whatsapp.com','api.whatsapp.com','web.whatsapp.com','wasap.my','www.wasap.my'].includes(u.hostname)}catch{return false}}
export function publicVehicle(car){
  if(!car||car.publication!=='published'||!uuid.test(car.id||''))return null;
  const price=Number(car.price);if(!Number.isFinite(price)||price<0)return null;
  return {content_ids:[car.id],content_type:'product',content_name:[car.brand,car.model].filter(Boolean).join(' ').slice(0,100),value:price,currency:'MYR'};
}
export function createTracking({eligible,isCar,load,send,revoke}){
  let allowed=false,started=false,pageSent=false,viewSent=false,calculated=false,vehicle=null;
  function event(name,data={},custom=false){if(allowed&&started)send(name,data,custom)}
  function activate(){
    if(!eligible||!allowed||(isCar&&!vehicle))return;
    if(!started){load();started=true}
    if(!pageSent){event('PageView');pageSent=true}
    if(vehicle&&!viewSent){event('ViewContent',vehicle);viewSent=true}
  }
  return {
    consent(value){allowed=value===true;if(!allowed){if(started)revoke();return}activate()},
    vehicle(car){vehicle=publicVehicle(car);if(vehicle)activate()},
    contact(href){if(whatsapp(href))event('Contact',{contact_method:'WhatsApp'})},
    calculate(){if(allowed&&started&&vehicle&&!calculated){calculated=true;event('LoanCalculator',{},true)}},
    get started(){return started}
  };
}
