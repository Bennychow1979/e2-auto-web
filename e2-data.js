import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm';

export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const rm = (n, digits = 0) => 'RM' + Number(n).toLocaleString('en-MY', {minimumFractionDigits:digits,maximumFractionDigits:digits});
export const mileageText = car => car.mileage === null ? 'Pending confirmation' : Number(car.mileage).toLocaleString('en-MY') + ' km' + (car.mileage_confirmed ? '' : ' · pending confirmation');
const config = window.E2_CONFIG || {};
export const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(config.supabaseUrl || '') && /^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey || '');
// Public pages never inherit a staff session, even in the same browser.
const staffPage = ['/portal.html','/team.html','/accept-invite.html'].some(path=>location.pathname.endsWith(path)) || (location.pathname.endsWith('/car.html') && new URLSearchParams(location.search).get('preview')==='1');
export const db = configured ? createClient(config.supabaseUrl, config.publishableKey, {
  auth: {persistSession:staffPage,autoRefreshToken:staffPage,detectSessionInUrl:staffPage,storageKey:'e2-staff-auth'}
}) : null;
export function check(result) { if (result.error) throw result.error; return result.data; }
export function friendlyError(error) {
  if (error?.code === '23505') return 'This plate or photo position already exists. Refresh and check the record.';
  if (error?.code === '42501') return 'Your account does not have permission. Sign in again or contact your administrator.';
  if (error?.message === 'Failed to fetch') return 'Connection interrupted. Check your connection and retry; saved records remain in the database.';
  return error?.message || 'Unable to complete this action. Please try again.';
}
export async function getVehicles({staff = false, id = null} = {}) {
  if (!db) throw new Error('The E2 inventory connection is being prepared. Please contact E2 for current availability.');
  const rows = [];
  for (let offset=0; ; offset+=100) {
    let query = db.from('vehicles').select('*,vehicle_photos(*)').order('created_at',{ascending:false}).order('id').range(offset,offset+99);
    if (!staff) query = query.eq('publication','published');
    if (id) query = query.eq('id',id);
    const batch = check(await query); rows.push(...batch);
    if (batch.length < 100 || id) break;
  }
  for (const row of rows) row.photos=(row.vehicle_photos || []).sort((a,b)=>a.position-b.position);
  return rows;
}
export async function photoURLs(photos) {
  if (!photos.length) return [];
  const data = check(await db.storage.from('vehicle-photos').createSignedUrls(photos.map(p=>p.path),300));
  return data.map((item,i)=>({...photos[i],url:item.signedUrl || null}));
}
export async function coverURL(car) { return car.photos.length ? (await photoURLs(car.photos.slice(0,1)))[0].url : null; }
export async function compressPhoto(file) {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size < 1 || file.size > 20*1024*1024)
    throw new Error('Choose a JPG, PNG or WebP photo up to 20 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1,1920/Math.max(bitmap.width,bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*scale)); canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',0.84));
    if (!blob || blob.type!=='image/webp' || blob.size>3*1024*1024) throw new Error('This photo could not be reduced below 3 MB. Choose a smaller image.');
    return blob;
  } finally { bitmap.close(); }
}
