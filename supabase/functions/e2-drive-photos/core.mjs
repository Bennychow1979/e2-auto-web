export const MAX_BYTES=20*1024*1024;
export const FILE_ID=/^[A-Za-z0-9_-]{10,200}$/;
export const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const MIME=new Set(['image/jpeg','image/png','image/webp']);
export function folderId(value) {
  const text=String(value||'').trim();
  if(FILE_ID.test(text))return text;
  try {
    const url=new URL(text),match=url.pathname.match(/^\/drive\/(?:u\/\d+\/)?folders\/([A-Za-z0-9_-]+)\/?$/);
    if(url.protocol==='https:'&&url.hostname==='drive.google.com'&&!url.port&&!url.username&&!url.password&&match&&FILE_ID.test(match[1]))return match[1];
  }catch{}
  throw new Error('Paste a Google Drive vehicle-folder link.');
}
export const normalizePlate=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
// Folder names must begin with the complete plate, followed by a separator/model.
export function matchesPlate(name,plate) {
  const first=String(name||'').trim().split(/\s|_|[()[\]]/)[0];
  return normalizePlate(first)===normalizePlate(plate)&&!!normalizePlate(plate);
}
export function checkFolder(folder,root,plate) {
  if(folder.trashed||folder.mimeType!=='application/vnd.google-apps.folder'||!folder.parents?.includes(root))
    throw new Error('Choose a vehicle folder directly inside E2 Vehicle Uploads.');
  if(!matchesPlate(folder.name,plate))throw new Error('Folder plate does not match this vehicle. Nothing was added.');
}
export function validPhoto(file,folder) {
  return FILE_ID.test(file.id||'')&&!file.trashed&&file.parents?.includes(folder)&&
    MIME.has(file.mimeType)&&Number(file.size)>0&&Number(file.size)<=MAX_BYTES&&
    /^[a-f0-9]{32}$/.test(file.md5Checksum||'')&&file.capabilities?.canDownload===true;
}
export function uniquePhotos(files,folder) {
  const seen=new Set(),photos=[];let skipped=0;
  for(const file of files) {
    if(!validPhoto(file,folder)||seen.has(file.md5Checksum)){skipped++;continue}
    seen.add(file.md5Checksum);photos.push(file);
  }
  return {photos,skipped};
}
export function imageType(bytes) {
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if([137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))return 'image/png';
  if(new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP')return 'image/webp';
  return null;
}
const encoder=new TextEncoder();
export const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64=text=>Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
async function ticketKey(secret) {
  if(!secret||secret.length<32)throw new Error('Drive signing key is not configured.');
  return crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
}
export async function signTicket(payload,secret,now=Math.floor(Date.now()/1000)) {
  const data=b64(encoder.encode(JSON.stringify({...payload,exp:now+300})));
  const sig=await crypto.subtle.sign('HMAC',await ticketKey(secret),encoder.encode(data));
  return data+'.'+b64(sig);
}
export async function readTicket(token,secret,now=Math.floor(Date.now()/1000)) {
  try {
    if(typeof token!=='string'||token.length>3000)throw 0;
    const parts=token.split('.');if(parts.length!==2)throw 0;
    if(!await crypto.subtle.verify('HMAC',await ticketKey(secret),unb64(parts[1]),encoder.encode(parts[0])))throw 0;
    const payload=JSON.parse(new TextDecoder().decode(unb64(parts[0])));
    if(!Number.isInteger(payload.exp)||payload.exp<=now||payload.exp>now+300)throw 0;
    return payload;
  }catch{throw new Error('Photo link expired. Refresh the page.')}
}
