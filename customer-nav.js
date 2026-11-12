import {accountURL} from './customer-language.mjs?v=flow-20261113';
import {t,language} from './i18n.mjs';
import {customerDB as db,check} from './customer-data.js?v=customer-1';

const links=[...document.querySelectorAll('.navLogin')];
const partnerLinks=[...document.querySelectorAll('.navPartner')].map(link=>({link,html:link.innerHTML,href:link.getAttribute('href')}));
const favouriteLabel={en:'Favourite',ms:'Kegemaran',zh:'收藏'}[language]||'Favourite';
let revision=0,currentId=null;
function paint(name=null){
 for(const link of links){
  const label=link.querySelector('span');
  if(label)label.textContent=name||t('Sign in');
  link.href=accountURL('/customer.html',language);
  link.setAttribute('aria-label',name?t('Open profile for {name}',{name}):t('Sign in to your E2 account'));
  link.title=name?'E2 · '+name:t('Sign in');
 }
 for(const original of partnerLinks){
  const {link}=original;
  link.classList.toggle('navFavourite',!!name);
  if(name){
   link.href=accountURL('/saved.html',language);
   link.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg><span></span>';
   link.querySelector('span').textContent=favouriteLabel;
   link.setAttribute('aria-label',favouriteLabel);link.title=t('Saved cars');
  }else{
   link.innerHTML=original.html;link.setAttribute('href',original.href);
   link.removeAttribute('aria-label');link.removeAttribute('title');
  }
 }
}
async function refresh(){
 const run=++revision;let signedIn=false;
 try{
  const session=check(await db.auth.getSession()).session;if(run!==revision)return;
  if(!session){currentId=null;paint();return}
  signedIn=true;
  if(currentId!==session.user.id){currentId=session.user.id;paint(t('My profile'))}
  const user=check(await db.auth.getUser()).user;
  if(run!==revision)return;
  if(!user?.email_confirmed_at||!check(await db.rpc('e2_customer_allowed'))){if(run===revision){currentId=null;paint()}return}
  const profile=check(await db.from('customer_profiles').select('full_name').eq('user_id',user.id).maybeSingle());
  if(run!==revision)return;
  const name=[profile?.full_name,user.user_metadata?.full_name].find(value=>typeof value==='string'&&value.trim());
  paint(name?name.trim().replace(/\s+/g,' ').slice(0,100):t('My profile'));
 }catch{if(run===revision)paint(signedIn?t('My profile'):null)}
}
if(db&&links.length){
 db.auth.onAuthStateChange(event=>{
  if(event==='SIGNED_OUT'){revision++;currentId=null;paint();return}
  if(['SIGNED_IN','USER_UPDATED','TOKEN_REFRESHED'].includes(event)){
   // Let the Auth callback finish before querying the database.
   revision++;setTimeout(refresh,0);
  }
 });
 window.addEventListener('focus',refresh);
 window.addEventListener('pageshow',refresh);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});
 await refresh();
}
