// Anonymous public interface only. Never pass a staff/customer session to this reader.
export const profileFields = 'user_id,display_name,position,bio,languages,whatsapp,photo_path,is_public';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = value => typeof value === 'string' ? value.trim() : '';
export function publicProfile(row) {
  if (!row || row.is_public !== true || !uuid.test(row.user_id) || !text(row.display_name)) return null;
  const path = text(row.photo_path);
  return {
    id: row.user_id, name: text(row.display_name), position: text(row.position),
    bio: text(row.bio), languages: text(row.languages),
    phone: /^[1-9][0-9]{7,14}$/.test(text(row.whatsapp)) ? text(row.whatsapp) : '',
    photo: path.startsWith(row.user_id + '/') && /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.webp$/i.test(path) ? path : ''
  };
}
export function contactURL(profile, message) {
  return /^[1-9][0-9]{7,14}$/.test(profile?.phone || '') ? 'https://wa.me/' + profile.phone + '?text=' + encodeURIComponent(message) : null;
}
export function publicTeamSource(config, request = fetch) {
  const valid = /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(config?.supabaseUrl || '') && /^sb_publishable_[A-Za-z0-9_-]+$/.test(config?.publishableKey || '');
  async function read(path, options = {}) {
    if (!valid) throw Error('Public connection unavailable');
    const result = await request(config.supabaseUrl + path, {
      ...options, headers: {apikey: config.publishableKey, 'Content-Type': 'application/json'},
      credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(8000)
    });
    if (!result.ok) throw Error('Public request unavailable');
    return result.json();
  }
  return {
    async profiles() {
      const profiles = new Map();
      for (let offset = 0; ; offset += 100) {
        // Active-account filtering is enforced by existing anonymous RLS, not by a role exposed in the browser.
        const rows = await read('/rest/v1/staff_profiles?' + new URLSearchParams({select: profileFields, is_public: 'eq.true', order: 'display_name.asc,user_id.asc', offset, limit: 100}));
        if (!Array.isArray(rows)) throw Error('Invalid public response');
        for (const row of rows) { const profile = publicProfile(row); if (profile) profiles.set(profile.id, profile); }
        if (rows.length < 100) return [...profiles.values()];
      }
    },
    async portrait(profile) {
      if (!profile.photo) return null;
      const result = await read('/storage/v1/object/sign/staff-photos/' + profile.photo, {method: 'POST', body: JSON.stringify({expiresIn: 300})});
      if (typeof result.signedURL !== 'string' || !result.signedURL.startsWith('/object/sign/staff-photos/')) throw Error('Invalid portrait URL');
      const url = new URL(config.supabaseUrl + '/storage/v1' + result.signedURL);
      if (url.origin !== config.supabaseUrl || !url.pathname.startsWith('/storage/v1/object/sign/staff-photos/')) throw Error('Invalid portrait URL');
      return url.href;
    }
  };
}
