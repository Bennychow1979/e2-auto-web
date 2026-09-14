
const origins=new Set(['https://e2auto.my','https://bennychow1979.github.io']);
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const check=r=>{if(r.error)throw r.error;return r.data};
const first=r=>Array.isArray(r)?r[0]:r;
async function limitedBody(req,max){const reader=req.body?.getReader();if(!reader)throw Error('Empty request.');const parts=[];let size=0;while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw Error('Request too large.')}parts.push(value)}const bytes=new Uint8Array(size);let pos=0;for(const part of parts){bytes.set(part,pos);pos+=part.length}return bytes}
export async function detectMime(file){const b=new Uint8Array(await file.slice(0,12).arrayBuffer());if(b[0]===255&&b[1]===216&&b[2]===255)return 'image/jpeg';if([137,80,78,71,13,10,26,10].every((v,i)=>b[i]===v))return 'image/png';if(String.fromCharCode(...b.slice(0,5))==='%PDF-')return 'application/pdf';throw Error('Choose a JPG, PNG or PDF file.')}
export function createHandler(admin){
 const rpc=async(name,args={})=>first(check(await admin.rpc(name,args)));
 const bucket=()=>admin.storage.from('intake-documents');
 async function cleanup(){try{const stale=check(await admin.rpc('e2_intake_expired_files'));if(!stale?.length)return;const result=await bucket().remove(stale.map(x=>x.path));if(result.error)return;for(const f of stale)await admin.rpc('e2_intake_purge_expired',{file_id:f.id})}catch{/* Best effort; never return file paths or log customer data. */}}
 return async req=>{
  const origin=req.headers.get('Origin')||'',headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Headers':'content-type, apikey','Access-Control-Allow-Methods':'POST, OPTIONS',...(origins.has(origin)?{'Access-Control-Allow-Origin':origin}:{})};
  const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});
  if(origin&&!origins.has(origin))return reply(403,{error:'Origin not allowed.'});if(req.method==='OPTIONS')return new Response(null,{status:204,headers});if(req.method!=='POST')return reply(405,{error:'Use POST.'});
  try{
   const multipart=req.headers.get('Content-Type')?.startsWith('multipart/form-data');
   if(multipart){
    const bytes=await limitedBody(req,10485760+16384),form=await new Response(bytes,{headers:{'Content-Type':req.headers.get('Content-Type')}}).formData();
    const target=form.get('target'),nonce=form.get('nonce'),file_id=form.get('file_id'),file=form.get('file');
    if(!uuid(target)||!uuid(nonce)||!uuid(file_id)||!file||typeof file==='string'||!file.name||file.name.length>160||file.size<1||file.size>10485760)throw Error('Choose a valid file up to 10 MB.');
    const mime=await detectMime(file);let months;try{months=JSON.parse(form.get('months')||'[]')}catch{throw Error('Choose statement months.')};if(!Array.isArray(months)||months.length>6||months.some(m=>typeof m!=='string'))throw Error('Choose statement months.');
    const category=form.get('category');if(typeof category!=='string'||category.length>40)throw Error('Choose a document category.');
    const reserved=await rpc('e2_intake_prepare_file',{target,nonce,file_id,doc_category:category,file_name:file.name,file_mime:mime,file_bytes:file.size,months});
    if(reserved.state!=='ready'){
     const uploaded=await bucket().upload(reserved.path,file,{contentType:mime,cacheControl:'0',upsert:false});
     // A previous response may have been lost. Finalization checks actual stored size and MIME.
     try{await rpc('e2_intake_finish_file',{target,nonce,file_id})}catch(e){if(uploaded.error)throw Error('Upload interrupted. Retry this file.');throw e}
    }
    return reply(200,{file_id,uploaded:true});
   }
   const bytes=await limitedBody(req,65536);let b;try{b=JSON.parse(new TextDecoder().decode(bytes))}catch{throw Error('Invalid request.')};if(!b||typeof b!=='object'||Array.isArray(b)||b.website)throw Error('Invalid request.');
   if(b.action==='context'){if(!uuid(b.invite))throw Error('Open a valid invitation.');const context=await rpc('e2_intake_context',{invite:b.invite});await cleanup();return reply(200,context)}
   if(b.action==='begin'){if(!uuid(b.invite)||!uuid(b.nonce))throw Error('Open a valid invitation.');return reply(200,await rpc('e2_intake_begin',{invite:b.invite,nonce:b.nonce,kind:b.kind}))}
   if(!uuid(b.target)||!uuid(b.nonce))throw Error('Upload session unavailable.');
   if(b.action==='remove'){
    if(!uuid(b.file_id))throw Error('Choose a file.');const path=await rpc('e2_intake_remove_file',{target:b.target,nonce:b.nonce,file_id:b.file_id});if(path){check(await bucket().remove([path]));await rpc('e2_intake_forget_file',{target:b.target,nonce:b.nonce,file_id:b.file_id})}return reply(200,{removed:true});
   }
   if(b.action==='submit')return reply(200,await rpc('e2_intake_submit',{target:b.target,nonce:b.nonce,input:b.details,consent:b.consent===true,accurate:b.accurate===true,contacts:b.contacts===true}));
   // Never provide an anonymous read, list, download, staff action or arbitrary RPC proxy.
   return reply(400,{error:'Action not available.'});
  }catch(e){return reply(e.message==='Request too large.'?413:400,{error:e.message||'Could not complete this request. Please try again.'})}
 }
}
