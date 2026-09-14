
const config=window.E2_CONFIG||{};
const endpoint=config.supabaseUrl+'/functions/v1/e2-guest-intake';
async function send(body){const form=body instanceof FormData;const r=await fetch(endpoint,{method:'POST',headers:{apikey:config.publishableKey,...(form?{}:{'Content-Type':'application/json'})},body:form?body:JSON.stringify(body),cache:'no-store',referrerPolicy:'no-referrer'});let result;try{result=await r.json()}catch{throw Error('Connection interrupted. Please try again.')}if(!r.ok)throw Error(result.error||'Unable to submit. Please try again.');return result}
export const context=invite=>send({action:'context',invite});
export const begin=(invite,nonce,kind)=>send({action:'begin',invite,nonce,kind});
export const upload=(session,nonce,q)=>{const form=new FormData();for(const [k,v] of Object.entries({target:session.id,nonce,file_id:q.id,category:q.category,months:JSON.stringify(q.months)}))form.set(k,v);form.set('file',q.file);return send(form)};
export const remove=(session,nonce,file_id)=>send({action:'remove',target:session.id,nonce,file_id});
export const submit=(session,nonce,details,checks,website)=>send({action:'submit',target:session.id,nonce,details,...checks,website});
