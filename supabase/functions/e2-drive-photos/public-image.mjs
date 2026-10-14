import {UUID,FILE_ID,MIME,MAX_BYTES,checkFolder,validPhoto,imageType} from './core.mjs';

const unavailable='Public vehicle image is unavailable.';
const checked=result=>{if(result.error)throw Error(unavailable);return result.data;};
const photoFields='id,vehicle_id,source,path,position';
const linkFields='photo_id,vehicle_id,folder_id,file_id,checksum,mime_type,size_bytes';
const same=(a,b,fields)=>!!a&&!!b&&fields.every(key=>a[key]===b[key]);

// Object UUIDs are generated before upload. They are independent of photo row IDs.
// Use the exact associated path, restricted to this vehicle's canonical namespace.
export function validUploadPath(path,vehicle){
  if(typeof path!=='string'||!UUID.test(vehicle||''))return false;
  const parts=path.split('/');
  return parts.length===2&&parts[0]===vehicle&&/^[0-9a-f-]{36}\.webp$/.test(parts[1])&&UUID.test(parts[1].slice(0,-5));
}

export async function publicVehicleImage(req,{publicClient,admin,drive,driveReady,root,headers}){
  const reply=(status,error=unavailable)=>new Response(JSON.stringify({error}),{status,headers});
  try{
    const params=new URL(req.url).searchParams,ids=params.getAll('public_vehicle');
    if(!['GET','HEAD'].includes(req.method)||ids.length!==1||!UUID.test(ids[0])||[...params.keys()].some(key=>key!=='public_vehicle'))
      return reply(400,'Invalid public vehicle image request.');
    const id=ids[0].toLowerCase();
    const readCar=async()=>checked(await publicClient.from('vehicles').select('id,plate,publication').eq('id',id).eq('publication','published').maybeSingle());
    const readPhoto=async()=>checked(await publicClient.from('vehicle_photos').select(photoFields).eq('vehicle_id',id).order('position').order('id').limit(1).maybeSingle());
    const car=await readCar();
    if(!car||car.id!==id||car.publication!=='published')return reply(404);
    const photo=await readPhoto();
    if(!photo||!UUID.test(photo.id||'')||photo.vehicle_id!==id)return reply(404);
    let bytes=null,mime,link=null;
    const readLink=async()=>checked(await admin.from('vehicle_drive_photos').select(linkFields).eq('photo_id',photo.id).eq('vehicle_id',id).maybeSingle());
    if(photo.source==='upload'){
      if(!validUploadPath(photo.path,id))return reply(404);
      mime='image/webp';
      if(req.method==='GET'){
        const result=await publicClient.storage.from('vehicle-photos').download(photo.path);
        if(result.error||!result.data||result.data.size<1||result.data.size>3145728)return reply(404);
        bytes=new Uint8Array(await result.data.arrayBuffer());
        if(bytes.length!==result.data.size||imageType(bytes)!==mime)return reply(404);
      }
    }else if(photo.source==='drive'){
      if(photo.path!==id+'/'+photo.id+'.drive')return reply(404);
      if(!driveReady())return reply(503);
      link=await readLink();
      if(!link||link.photo_id!==photo.id||link.vehicle_id!==id||!FILE_ID.test(link.folder_id||'')||!FILE_ID.test(link.file_id||'')||
        !/^[a-f0-9]{32}$/.test(link.checksum||'')||!MIME.has(link.mime_type)||!Number.isInteger(link.size_bytes)||link.size_bytes<1||link.size_bytes>MAX_BYTES)return reply(404);
      const folder=await drive.metadata(link.folder_id);
      if(folder.id!==link.folder_id)return reply(404);
      checkFolder(folder,root,car.plate);
      const meta=await drive.metadata(link.file_id);
      if(meta.id!==link.file_id||!validPhoto(meta,link.folder_id)||meta.md5Checksum!==link.checksum||meta.mimeType!==link.mime_type||Number(meta.size)!==link.size_bytes)return reply(404);
      mime=link.mime_type;
      if(req.method==='GET'){
        bytes=await drive.image(link.file_id,link.checksum,mime);
        if(bytes.length!==link.size_bytes||imageType(bytes)!==mime)return reply(404);
      }
    }else return reply(404);
    // Do not serve a former first photo or a replaced link after any awaited read.
    const currentPhoto=await readPhoto();
    if(!same(photo,currentPhoto,photoFields.split(',')))return reply(404);
    if(link&&!same(link,await readLink(),linkFields.split(',')))return reply(404);
    const latest=await readCar();
    if(!same(car,latest,['id','plate','publication']))return reply(404);
    return new Response(bytes,{headers:{...headers,'Content-Type':mime,'X-E2-Public-Image':'v2','X-Content-Type-Options':'nosniff','Content-Disposition':'inline','Referrer-Policy':'no-referrer'}});
  }catch{
    // Public responses never reflect SDK errors, Drive IDs, credentials or URLs.
    return reply(404);
  }
}
