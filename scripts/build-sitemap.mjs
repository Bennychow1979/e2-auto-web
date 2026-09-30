import {readFile, writeFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {pathToFileURL} from 'node:url';
import {SITE_URL, validVehicleId, canonicalVehicleURL} from '../vehicle-seo.mjs';

const escapeXML = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));

export function renderSitemap(rows) {
  const seen = new Set();
  const entries = ['  <url><loc>' + SITE_URL + '</loc></url>'];
  for (const row of rows) {
    if (row?.publication !== 'published' || !validVehicleId(row.id)) continue;
    const location = canonicalVehicleURL(row.id);
    if (seen.has(location)) continue;
    seen.add(location);
    const date = row.updated_at ? new Date(row.updated_at) : null;
    const lastmod = date && Number.isFinite(date.getTime()) ? '<lastmod>' + date.toISOString() + '</lastmod>' : '';
    entries.push('  <url><loc>' + escapeXML(location) + '</loc>' + lastmod + '</url>');
  }
  if (entries.length > 50000) throw new Error('Inventory needs a sitemap index before deployment.');
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + entries.join('\n') + '\n</urlset>\n';
}

export async function loadPublishedVehicles(config, request = fetch) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(config?.supabaseUrl || '') ||
      !/^sb_publishable_[A-Za-z0-9_-]+$/.test(config?.publishableKey || '')) {
    throw new Error('A public inventory connection is required to build the sitemap.');
  }
  const rows = [];
  for (let offset = 0; ; offset += 500) {
    const url = new URL(config.supabaseUrl + '/rest/v1/vehicles');
    url.search = new URLSearchParams({select:'id,publication,updated_at',publication:'eq.published',order:'id.asc',limit:'500',offset:String(offset)});
    const response = await request(url, {
      headers:{apikey:config.publishableKey, Accept:'application/json'},
      credentials:'omit', cache:'no-store', signal:AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error('Public inventory request failed (' + response.status + '). Existing deployment is unchanged.');
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error('Unexpected inventory response; sitemap was not overwritten.');
    rows.push(...batch);
    if (batch.length < 500) return rows;
    if (rows.length >= 50000) throw new Error('Inventory needs a sitemap index before deployment.');
  }
}

async function main() {
  // Use only the same anonymous publishable key as the public showroom, never a staff session.
  const context = {window:{}};
  runInNewContext(await readFile(new URL('../e2-config.js', import.meta.url), 'utf8'), context, {timeout:1000});
  const rows = await loadPublishedVehicles(context.window.E2_CONFIG);
  const sitemap = renderSitemap(rows);
  await writeFile(new URL('../sitemap.xml', import.meta.url), sitemap);
  console.log('Sitemap generated for ' + (sitemap.match(/<loc>/g).length - 1) + ' published vehicles and the homepage.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
