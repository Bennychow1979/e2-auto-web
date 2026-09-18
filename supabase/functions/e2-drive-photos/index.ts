import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {folderId,checkFolder,validPhoto,uniquePhotos,signTicket,readTicket,UUID,FILE_ID} from './core.mjs';
import {googleDrive} from './google.mjs';

const origins=new Set(['https://e2auto.my','https://bennychow1979.github.io']);
const url=Deno.env.get('SUPABASE_URL')||'';
const anon=Deno.env.get('SUPABASE_ANON_KEY')||'';
const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
let serverKeys=[];try{serverKeys=Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}')).filter(key=>typeof key==='string'&&key.startsWith('sb_secret_')&&key.length>30)}catch{}
const root=Deno.env.get('E2_DRIVE_ROOT_FOLDER_ID')||'1shtrbAggeUA8mc2lt8eBF4D8v-LFsqjx';
const signing=Deno.env.get('E2_DRIVE_SIGNING_SECRET')||'';
let credentials=null;try{credentials=JSON.parse(Deno.env.get('E2_DRIVE_SERVICE_ACCOUNT_JSON')||'null')}catch{}
const drive=googleDrive(credentials);
const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
const ready=()=>!!credentials?.client_email&&!!credentials?.private_key&&signing.length>=32&&FILE_ID.test(root);
const checked=result=>{if(result.error)throw new Error(result.error.message);return result.data};
const imageURL=async payload=>url+'/functions/v1/e2-drive-photos?ticket='+encodeURIComponent(await signTicket(payload,signing));

async function membership(actor,manage=false) {
  if(!UUID.test(actor||''))return false;
  const row=checked(await admin.from('staff_memberships').select('role,active').eq('user_id',actor).maybeSingle());
  return row?.active&&(manage?['super_admin','admin']:['super_admin','admin','sales']).includes(row.role);
}
async function getCar(id) {
  if(!UUID.test(id||''))throw new Error('Choose a saved vehicle.');
  const car=checked(await admin.from('vehicles').select('id,plate,publication').eq('id',id).maybeSingle());
  if(!car)throw new Error('Vehicle is no longer available.');
  return car;
}
async function folderFor(car,id) {
  checkFolder(await drive.metadata(id),root,car.plate);
}

Deno.serve(async req=>{
  const origin=req.headers.get('Origin')||'';
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, GET, OPTIONS',...(origins.has(origin)?{'Access-Control-Allow-Origin':origin}:{})};
  const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});
  if(origin&&!origins.has(origin))return reply(403,{error:'Origin not allowed'});
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  try {
    if(req.method==='GET') {
      if(!ready())return reply(503,{error:'Google Drive is not connected.'});
      const ticket=await readTicket(new URL(req.url).searchParams.get('ticket'),signing);
      let file,folder,checksum,mime,vehicle;
      if(ticket.kind==='photo'&&UUID.test(ticket.id||'')) {
        const row=checked(await admin.from('vehicle_drive_photos').select('*').eq('photo_id',ticket.id).maybeSingle());
        if(!row)throw new Error('Photo is no longer available.');
        ({file_id:file,folder_id:folder,checksum,mime_type:mime,vehicle_id:vehicle}=row);
      }else if(ticket.kind==='preview') {
        ({file,folder,checksum,mime,vehicle}=ticket);
        if(!await membership(ticket.actor,true))return reply(403,{error:'Admin access required'});
      }else return reply(403,{error:'Invalid photo link.'});
      const car=await getCar(vehicle);
      if(ticket.kind==='preview'&&car.publication!=='draft')return reply(403,{error:'Preview is no longer available.'});
      if(car.publication!=='published'&&!await membership(ticket.actor))return reply(403,{error:'This photo is private.'});
      await folderFor(car,folder);
      const meta=await drive.metadata(file);
      if(!validPhoto(meta,folder)||meta.md5Checksum!==checksum||meta.mimeType!==mime)throw new Error('Drive photo changed or is unavailable. Review its link.');
      const bytes=await drive.image(file,checksum,mime);
      // A second access check covers a draft/publication or membership change during the fetch.
      const latest=await getCar(vehicle);
      if(latest.publication!=='published'&&!await membership(ticket.actor))return reply(403,{error:'This photo is private.'});
      if(ticket.kind==='preview'&&(latest.publication!=='draft'||!await membership(ticket.actor,true)))return reply(403,{error:'Preview is no longer available.'});
      if(ticket.kind==='photo'&&!checked(await admin.from('vehicle_drive_photos').select('photo_id').eq('photo_id',ticket.id).maybeSingle()))return reply(404,{error:'Photo was removed.'});
      return new Response(bytes,{headers:{...headers,'Content-Type':mime,'X-Content-Type-Options':'nosniff','Content-Disposition':'inline','Referrer-Policy':'no-referrer'}});
    }
    if(req.method!=='POST')return reply(405,{error:'Use POST'});
    const raw=await req.text();if(raw.length>16000)return reply(413,{error:'Request too large'});
    let body;try{body=JSON.parse(raw)}catch{return reply(400,{error:'Invalid request'})}
    const authorization=req.headers.get('Authorization')||'';
    // Dashboard-only, read-only connection check. Never issues photo URLs or changes stock.
    if(body.action==='connection-check') {
      if(!(service&&authorization==='Bearer '+service)&&!serverKeys.includes(req.headers.get('apikey')||''))return reply(403,{error:'Server administration access required'});
      if(!ready())return reply(503,{error:'Google Drive is not configured.'});
      const folder=await drive.metadata(root);
      if(folder.trashed||folder.mimeType!=='application/vnd.google-apps.folder')throw new Error('The configured root folder is unavailable.');
      const children=await drive.list(root);
      let samplePhotoReadable=null,samplePhotos=null;
      if(body.sample_folder) {
        const sample=folderId(body.sample_folder);
        if(!children.some(file=>file.id===sample&&file.mimeType==='application/vnd.google-apps.folder'))throw new Error('Sample folder is outside the configured root.');
        const {photos}=uniquePhotos(await drive.list(sample),sample);
        samplePhotos=photos.length;
        if(photos.length){await drive.image(photos[0].id,photos[0].md5Checksum,photos[0].mimeType);samplePhotoReadable=true}
      }
      return reply(200,{connected:true,root:folder.name,vehicleFolders:children.filter(file=>file.mimeType==='application/vnd.google-apps.folder').length,samplePhotos,samplePhotoReadable});
    }
    const authClient=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
    let actor=null;
    // Public requests may use the legacy anon JWT; only a verified Auth user gains staff access.
    if(authorization.startsWith('Bearer ')) {
      const result=await authClient.auth.getUser(authorization.slice(7));
      if(!result.error)actor=result.data.user?.id||null;
    }
    const caller=actor?createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}}):authClient;
    if(body.action==='urls') {
      if(!ready())return reply(503,{error:'Google Drive is not connected.'});
      if(!Array.isArray(body.ids)||body.ids.length>100||body.ids.some(id=>!UUID.test(id)))return reply(400,{error:'Invalid photo selection'});
      const photos=checked(await caller.from('vehicle_photos').select('id,vehicle_id').eq('source','drive').in('id',body.ids));
      const items=await Promise.all(photos.map(async photo=>({id:photo.id,url:await imageURL({kind:'photo',id:photo.id,actor})})));
      return reply(200,{photos:items});
    }
    if(!actor||!await membership(actor,true))return reply(403,{error:'Sign in with an Admin account.'});
    if(body.action==='status')return reply(200,{ready:ready(),message:ready()?'Google Drive is connected.':'Google Drive needs a one-time connection. Uploaded photos still work.'});
    if(!ready())return reply(503,{error:'Google Drive needs a one-time connection. Uploaded photos still work.'});
    if(!['list','attach'].includes(body.action))return reply(400,{error:'Unknown action'});
    const car=await getCar(body.vehicle);
    if(car.publication!=='draft')return reply(409,{error:'Move this vehicle to draft before linking photos.'});
    const folder=folderId(body.folder);
    await folderFor(car,folder);
    const {photos,skipped}=uniquePhotos(await drive.list(folder),folder);
    if(body.action==='list') {
      const existing=checked(await admin.from('vehicle_drive_photos').select('file_id,checksum').eq('vehicle_id',car.id));
      const items=await Promise.all(photos.map(async file=>({
        id:file.id,name:file.name,checksum:file.md5Checksum,size:Number(file.size),
        linked:existing.some(p=>p.file_id===file.id||p.checksum===file.md5Checksum),
        url:await imageURL({kind:'preview',vehicle:car.id,folder,file:file.id,checksum:file.md5Checksum,mime:file.mimeType,actor})
      })));
      return reply(200,{folder,plate:car.plate,photos:items,skipped});
    }
    if(!Array.isArray(body.files)||body.files.length<1||body.files.length>30||new Set(body.files.map(f=>f.id)).size!==body.files.length)return reply(400,{error:'Select between 1 and 30 different photos.'});
    const selected=body.files.map(choice=>{
      const file=photos.find(p=>p.id===choice.id);
      if(!file||file.md5Checksum!==choice.checksum)throw new Error('A selected photo changed. Load the folder again.');
      return file;
    });
    // Read the selected bytes once before saving, to reject corrupt/replaced files.
    for(const file of selected)await drive.image(file.id,file.md5Checksum,file.mimeType);
    if(!await membership(actor,true))return reply(403,{error:'Admin access required'});
    await folderFor(car,folder);
    const added=checked(await admin.rpc('e2_attach_drive_photos',{actor_id:actor,target_vehicle:car.id,expected_plate:car.plate,items:selected.map(file=>({
      folder_id:folder,file_id:file.id,checksum:file.md5Checksum,mime_type:file.mimeType,size_bytes:Number(file.size)
    }))}));
    return reply(200,{added});
  }catch(error) {
    // Do not include credentials, Google error payloads or signed URLs in logs.
    return reply(400,{error:error instanceof Error?error.message:'Drive photo request failed. Refresh before retrying.'});
  }
});
