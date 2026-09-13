export const COMPANY_PHONE = '60122785126';
export const validId = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');
export function vehicleShareURL(base, vehicleId, staffId) {
  if (!validId(vehicleId) || !validId(staffId)) throw Error('Choose a vehicle and a published staff profile.');
  return vehiclePageURL(base, vehicleId, staffId);
}
export function vehiclePageURL(base, vehicleId, staffId) {
  if (!validId(vehicleId)) throw Error('Choose a vehicle.');
  const url = new URL('car.html', base);
  url.searchParams.set('id', vehicleId);
  if (validId(staffId)) url.searchParams.set('sales', staffId);
  return url.href;
}
export function withVehicleLink(text, url, previousUrl = url) {
  const previousSuffix = '\n\nVehicle link: ' + previousUrl;
  const message = text.endsWith(previousSuffix) ? text.slice(0, -previousSuffix.length) : text;
  return message + '\n\nVehicle link: ' + url;
}
// Always anonymous, including on staff/preview pages. Never inherit staff tokens.
// Existing public-profile RLS excludes private, inactive and customer accounts.
export async function publicContact(id, config, request = fetch) {
  if (!validId(id) || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(config?.supabaseUrl || '') || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(config?.publishableKey || '')) return null;
  try {
    const url = new URL(config.supabaseUrl + '/rest/v1/staff_profiles');
    url.search = new URLSearchParams({select:'user_id,display_name,position,languages,whatsapp,photo_path',user_id:'eq.'+id,is_public:'eq.true',limit:'1'});
    const response = await request(url.href,{headers:{apikey:config.publishableKey},credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(8000)});
    if (!response.ok) return null;
    const rows = await response.json(), row = Array.isArray(rows) ? rows[0] : null;
    if (row?.user_id?.toLowerCase() !== id.toLowerCase() || !row.display_name || !/^[1-9][0-9]{7,14}$/.test(row.whatsapp || '')) return null;
    return row;
  } catch { return null; }
}
export function enquiryURL(contact, text) {
  const phone = /^[1-9][0-9]{7,14}$/.test(contact?.whatsapp || '') ? contact.whatsapp : COMPANY_PHONE;
  return 'https://wa.me/'+phone+'?text='+encodeURIComponent(text);
}
