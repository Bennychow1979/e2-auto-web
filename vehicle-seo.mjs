import {LANGUAGES,languageTags} from './i18n.mjs';
export const SITE_URL = 'https://e2auto.my/';
export const validVehicleId = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');

export function canonicalVehicleURL(id, lang = 'en') {
  if (!validVehicleId(id)) throw new Error('Invalid vehicle ID.');
  return SITE_URL + (['ms','zh'].includes(lang) ? lang + '/' : '') + 'car.html?id=' + id.toLowerCase();
}

export function vehicleMetadata(car, {preview = false, lang = 'en'} = {}) {
  if (preview || car?.publication !== 'published' || !validVehicleId(car?.id)) return null;
  const name = [car.year, car.brand, car.model, car.variant].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const status = car.stock_status === 'Sold' ? 'This vehicle is sold. Explore other E2 Auto cars.'
    : car.stock_status === 'Reserved' ? 'This vehicle is reserved. Ask E2 about availability.'
    : 'View photos and specifications, and arrange a viewing.';
  const descriptions={
    en:name+' used car at E2 Auto, Batu Caves, Selangor. '+status,
    ms:name+' terpakai di E2 Auto, Batu Caves, untuk KL dan Selangor. '+(car.stock_status==='Sold'?'Kereta ini sudah dijual. Lihat pilihan E2 Auto yang lain.':car.stock_status==='Reserved'?'Kereta ini ditempah. Hubungi E2 untuk semakan stok.':'Lihat foto dan spesifikasi serta atur lawatan.'),
    zh:name+'，E2 Auto Batu Caves 二手车，服务吉隆坡与雪兰莪。'+(car.stock_status==='Sold'?'此车辆已售出，欢迎浏览其他车辆。':car.stock_status==='Reserved'?'此车辆已预订，请向 E2 确认库存。':'浏览照片与规格，预约到店看车。')
  };
  const title=name+(lang==='ms'?' Terpakai':lang==='zh'?' 二手车':'')+' | E2 Auto Batu Caves';
  return {title,description:descriptions[lang]||descriptions.en,canonical:canonicalVehicleURL(car.id,lang)};
}

function setMeta(document, name, content, property = false) {
  const attribute = property ? 'property' : 'name';
  let node = document.querySelector('meta[' + attribute + '="' + name + '"]');
  if (!node) {
    node = document.createElement('meta');
    node.setAttribute(attribute, name);
    document.head.append(node);
  }
  node.setAttribute('content', content);
}

export function excludeVehicleFromSearch(document = globalThis.document) {
  setMeta(document, 'robots', 'noindex,nofollow');
  document.querySelector('link[rel="canonical"]')?.remove();
  for(const lang of [...LANGUAGES,'x-default'])document.querySelector('link[id="seo-language-'+lang+'"]')?.remove();
  for (const property of ['og:url', 'og:title', 'og:description']) {
    document.querySelector('meta[property="' + property + '"]')?.remove();
  }
}

export function applyVehicleMetadata(car, options = {}, document = globalThis.document) {
  const metadata = vehicleMetadata(car, options);
  if (!metadata) { excludeVehicleFromSearch(document); return; }
  document.title = metadata.title;
  setMeta(document, 'description', metadata.description);
  setMeta(document, 'robots', 'index,follow');
  setMeta(document, 'og:title', metadata.title, true);
  setMeta(document, 'og:description', metadata.description, true);
  setMeta(document, 'og:url', metadata.canonical, true);
  setMeta(document, 'og:type', 'website', true);
  let canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.setAttribute('rel', 'canonical');
    document.head.append(canonical);
  }
  canonical.setAttribute('href', metadata.canonical);
  for(const lang of [...LANGUAGES,'x-default']){
    let link=document.querySelector('link[id="seo-language-'+lang+'"]');
    if(!link){link=document.createElement('link');link.setAttribute('id','seo-language-'+lang);document.head.append(link)}
    link.setAttribute('rel','alternate');
    link.setAttribute('hreflang',languageTags[lang]||'x-default');
    link.setAttribute('href',canonicalVehicleURL(car.id,lang==='x-default'?'en':lang));
  }
}
