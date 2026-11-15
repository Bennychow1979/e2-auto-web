const MAX_BYTES=5*1024*1024;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedOrigins=new Set(['https://e2auto.my','https://bennychow1979.github.io']);
// Never reflect arbitrary Auth, database or Storage diagnostics to the caller.
const publicErrors=new Set(['Choose an image up to 5 MiB.','Image dimensions are outside the supported range.','Photo content does not match its JPEG, PNG or WebP type.','Invalid upload preparation.','Photo size changed. Choose the image again.','Active Sales access required','Active inventory staff access required','Upload is unavailable or expired','Photo changed. Choose a new image.']);
const check=result=>{if(result?.error)throw Error(publicErrors.has(result.error.message)?result.error.message:'Photo verification failed. Please retry.');return result?.data;};
export function createHandler(admin,{origins=allowedOrigins,inspectImage}={}){
 return async request=>{
  const origin=request.headers.get('origin'),headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
  if(origin&&origins.has(origin))Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'});
  const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});
  if(origin&&!origins.has(origin))return reply(403,{error:'This origin is not allowed.'});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return reply(405,{error:'Use POST.'});
  try{
   const bearer=request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
   if(!bearer)return reply(401,{error:'Sign in with your E2 staff account.'});
   if(!request.headers.get('content-type')?.startsWith('application/json'))return reply(415,{error:'Use JSON.'});
   if(Number(request.headers.get('content-length')||0)>512)return reply(413,{error:'Request too large.'});
   // Bound the body before buffering it. Never accept a file path or actor ID.
   const reader=request.body?.getReader();let size=0,chunks=[];
   if(reader){for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>512){await reader.cancel();return reply(413,{error:'Request too large.'});}chunks.push(value);}}
   const raw=new Uint8Array(size);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length;}
   let body;try{body=JSON.parse(new TextDecoder().decode(raw));}catch{return reply(400,{error:'Invalid request.'});}
   if(!body||Object.keys(body).length!==1||!UUID.test(body.upload||''))return reply(400,{error:'A prepared upload ID is required.'});
   const identity=await admin.auth.getUser(bearer);if(identity.error||!identity.data?.user?.id)return reply(401,{error:'Your staff session expired. Sign in again.'});
   const actor=identity.data.user.id;
   const context=check(await admin.rpc('e2_mileage_upload_context',{upload:body.upload,actor_id:actor}));
   if(!context||context.id!==body.upload||typeof context.path!=='string'||!new RegExp('^[0-9a-f-]{36}/'+actor+'/'+body.upload+'\\.(jpg|png|webp)$','i').test(context.path)||!Number.isInteger(context.byte_size)||context.byte_size<1||context.byte_size>MAX_BYTES)throw Error('Invalid upload preparation.');
   if(!UUID.test(context.path.split('/')[0]))throw Error('Invalid upload preparation.');
   const photo=check(await admin.storage.from('e2-mileage-evidence').download(context.path));
   if(photo.size!==context.byte_size||photo.size>MAX_BYTES)throw Error('Photo size changed. Choose the image again.');
   if(typeof inspectImage!=='function')throw Error('Photo verification unavailable');
   const bytes=new Uint8Array(await photo.arrayBuffer()),mime=await inspectImage(bytes,context.mime_type);
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
   const result=check(await admin.rpc('e2_finalize_mileage_upload',{upload:body.upload,actor_id:actor,sha256:digest,actual_mime:mime,actual_bytes:bytes.length}));
   return reply(200,{id:result.id,ready:result.ready===true});
  }catch(error){return reply(400,{error:publicErrors.has(error?.message)?error.message:'Photo verification failed. Please retry.'});}
 };
}
