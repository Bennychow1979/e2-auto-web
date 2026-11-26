const key='e2-save-intent',ttl=24*60*60*1000;
let memory=null;
export function validId(id){return typeof id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)}
function valid(item){return validId(item?.id)&&Number.isFinite(item.at)&&Date.now()-item.at>=0&&Date.now()-item.at<ttl}
function read(){try{const item=JSON.parse(sessionStorage.getItem(key));if(valid(item))return item}catch{}return valid(memory)?memory:null}
function write(item){memory=item;try{sessionStorage.setItem(key,JSON.stringify(item))}catch{}}
export function rememberSave(id){if(validId(id))write({id,at:Date.now()})}
export function pendingSave(userId){const item=read();return item&&(!item.owner||!userId||item.owner===userId)?item.id:null}
export function bindSave(userId){const item=read();if(item&&pendingSave(userId))write({...item,owner:userId})}
// Email can open in a fresh Safari tab/browser. Carry only the public vehicle
// ID and expiry context, never an account ID, email address or auth token.
export function captureSave(search=globalThis.location?.search||''){
 const params=new URLSearchParams(search),item={id:params.get('save'),at:Number(params.get('save_at'))};
 if(valid(item)){const old=read();write(old?.id===item.id&&old.at===item.at?old:item);return item.id}return null;
}
export function saveReturnURL(value){
 const base=globalThis.location?.href||'https://e2auto.my/',url=new URL(value,base),item=read();
 if(url.origin===new URL(base).origin&&/^\/(customer|saved|customer-whatsapp|customer-whatsapp-test)\.html$/.test(url.pathname)&&item){url.searchParams.set('save',item.id);url.searchParams.set('save_at',String(item.at))}
 return url.href;
}
export function clearSave(expected){
 if(expected&&read()?.id!==expected)return;
 memory=null;try{sessionStorage.removeItem(key)}catch{}
}
