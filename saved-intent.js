const key='e2-save-intent';
export function validId(id){return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id||'')}
export function rememberSave(id){if(!validId(id))return;try{sessionStorage.setItem(key,JSON.stringify({id,at:Date.now()}))}catch{}}
export function pendingSave(){try{const item=JSON.parse(sessionStorage.getItem(key));if(validId(item?.id)&&Number.isFinite(item.at)&&Date.now()-item.at>=0&&Date.now()-item.at<1800000)return item.id}catch{}return null}
export function clearSave(){try{sessionStorage.removeItem(key)}catch{}}
