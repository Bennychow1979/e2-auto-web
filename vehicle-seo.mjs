export const SITE_URL = 'https://e2auto.my/';
export const validVehicleId = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '');

export function canonicalVehicleURL(id) {
  if (!validVehicleId(id)) throw new Error('Invalid vehicle ID.');
  return SITE_URL + 'car.html?id=' + id.toLowerCase();
}

export function vehicleMetadata(car, {preview = false} = {}) {
  if (preview || car?.publication !== 'published' || !validVehicleId(car?.id)) return null;
  const name = [car.year, car.brand, car.model, car.variant].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const status = car.stock_status === 'Sold' ? 'This vehicle is sold. Explore other E2 Auto cars.'
    : car.stock_status === 'Reserved' ? 'This vehicle is reserved. Ask E2 about availability.'
    : 'View photos and specifications, and arrange a viewing.';
  return {
    title: name + ' | E2 Auto Batu Caves',
    description: name + ' used car at E2 Auto, Batu Caves, Selangor. ' + status,
    canonical: canonicalVehicleURL(car.id),
  };
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
}
