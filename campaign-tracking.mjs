import {VERSION,CHOICE,STATE,campaignFromURL,readState,nextState,readChoice} from './campaign-core.mjs';
// Capture before the account initializer strips query/auth parameters.
const incoming=campaignFromURL(location.href), lang=new URL(location.href).searchParams.get('lang')||(/^\/(ms|zh)\//.exec(location.pathname)?.[1])||document.documentElement.lang.slice(0,2);
const copy={en:['Help improve your E2 experience','May we measure this visit and link it to a completed registration? We use a random browser ID and campaign source, not your contact details. Optional; browsing and registration work either way.','Allow measurement','No thanks','Visit measurement','Privacy'],ms:['Bantu kami menambah baik E2','Bolehkah kami mengukur lawatan ini dan mengaitkannya dengan pendaftaran lengkap? Kami menggunakan ID pelayar rawak dan sumber kempen, bukan butiran hubungan anda. Pilihan ini tidak menjejaskan carian atau pendaftaran.','Benarkan pengukuran','Tidak, terima kasih','Pengukuran lawatan','Privasi'],zh:['帮助我们改善 E2 体验','是否允许统计本次访问，并关联之后完成的注册？我们使用随机浏览器编号和推广来源，不记录你的联系资料。你可以拒绝，仍可正常浏览和注册。','允许统计','暂不允许','访问统计设置','隐私说明']}[lang]||null;
const c=copy||['Help improve your E2 experience','Allow first-party visit and registration measurement? Optional; browsing and registration work either way.','Allow measurement','No thanks','Visit measurement','Privacy'];
const read=k=>{try{return localStorage.getItem(k)}catch{return null}},write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}},remove=k=>{try{localStorage.removeItem(k)}catch{}};
let allowed=readChoice(read(CHOICE)),state=readState(read(STATE)),pending=null,sequence=0;
if(allowed===false){remove(STATE);state=null}
const eligible=/^\/(?:ms\/|zh\/)?(?:$|(?:index|showroom|car|customer|saved)\.html$|(?:cars|used-cars)\/[a-z0-9-]+\/$)/.test(location.pathname);
async function measure(){
 if(allowed!==true||!state||!eligible)return null;
 if(state.token)return state.token;
 if(pending)return pending;
 const current=state,run=sequence;
 pending=(async()=>{try{
  const cfg=window.E2_CONFIG;if(!cfg?.supabaseUrl||!cfg?.publishableKey)return null;
  const response=await fetch(cfg.supabaseUrl+'/rest/v1/rpc/e2_record_campaign_visit',{method:'POST',headers:{apikey:cfg.publishableKey,'Content-Type':'application/json'},body:JSON.stringify({request_id:current.request,visitor:current.visitor,campaign:current.campaign,content:current.content,landing_path:current.path,consent_version:VERSION}),signal:AbortSignal.timeout(5000)});
  if(!response.ok)return null;const token=await response.json();
  if(run!==sequence||allowed!==true||state!==current)return null;
  const checked=readState(JSON.stringify({...current,token}));if(!checked?.token)return null;
  state=checked;write(STATE,state);return token;
 }catch{return null}finally{pending=null}})();return pending;
}
function acceptState(){state=nextState(state,incoming,()=>crypto.randomUUID());if(state)write(STATE,state);void measure()}
export async function campaignSignupData(){
 // A long-lived form or another tab may have changed consent/last-touch source.
 allowed=readChoice(read(CHOICE));if(allowed!==true)return {};
 const latest=readState(read(STATE));if(!latest)return {};
 if(state?.request!==latest.request){sequence++;state=latest;if(pending)await pending}
 else if(latest.token)state.token=latest.token;
 const token=await measure();return token&&readChoice(read(CHOICE))===true?{e2_campaign_token:token}:{};
}
function setup(){
 if(!eligible||(!incoming&&!state&&allowed===null))return;
 const style=document.createElement('style');style.textContent='.e2Measure{position:fixed;z-index:10010;left:16px;right:16px;top:16px;max-width:540px;margin:auto;padding:18px;background:#fff;color:#171717;border:1px solid #b8b0a0;border-radius:14px;box-shadow:0 8px 35px #0003;font:15px/1.5 system-ui}.e2Measure h2{font-size:18px;margin:0 0 8px}.e2Measure p{margin:0 0 12px}.e2Measure button{padding:10px;margin:4px;border:1px solid #aaa;border-radius:8px;cursor:pointer}.e2Measure[hidden]{display:none}.e2MeasureSettings{margin:10px;padding:6px 10px;font:13px system-ui}';document.head.append(style);
 const panel=document.createElement('section');panel.className='e2Measure';panel.setAttribute('aria-label',c[0]);
 const h=document.createElement('h2');h.textContent=c[0];const p=document.createElement('p');p.textContent=c[1];
 const yes=document.createElement('button');yes.type='button';yes.textContent=c[2];const no=document.createElement('button');no.type='button';no.textContent=c[3];
 const privacy=document.createElement('a');privacy.href='/campaign-privacy.html?lang='+(['en','ms','zh'].includes(lang)?lang:'en');privacy.textContent=c[5];panel.append(h,p,yes,no,privacy);panel.hidden=allowed!==null;document.body.append(panel);
 const settings=document.createElement('button');settings.type='button';settings.className='e2MeasureSettings';settings.textContent=c[4];(document.querySelector('footer')||document.body).append(settings);
 const choose=value=>{sequence++;allowed=value;write(CHOICE,{version:VERSION,allowed:value,at:Date.now()});panel.hidden=true;if(value)acceptState();else{remove(STATE);state=null}settings.focus()};
 yes.onclick=()=>choose(true);no.onclick=()=>choose(false);settings.onclick=()=>{panel.hidden=false;yes.focus()};
 if(allowed===true)acceptState();
 window.addEventListener('storage',e=>{if(e.key===CHOICE||e.key===null){sequence++;allowed=readChoice(read(CHOICE));if(allowed!==true){state=null;remove(STATE)}else{state=readState(read(STATE));acceptState()}panel.hidden=allowed!==null}});
 window.addEventListener('online',()=>{void measure()});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});else setup();
