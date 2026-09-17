export const preferenceKey = 'e2-showroom-preferences-v1';
export const emptyFilters = Object.freeze({q:'',budget:'',body:'',brand:'',model:'',variant:'',engine:'',yearFrom:'',yearTo:'',transmission:''});
export const sortChoices = ['latest','price-low','price-high','year-new'];

export function readPreferences(storage, now = Date.now()) {
  const defaults = {filters:{...emptyFilters},sort:'latest'};
  try {
    const saved = JSON.parse(storage.getItem(preferenceKey));
    if (!saved || !Number.isFinite(saved.savedAt) || now - saved.savedAt > 4 * 60 * 60 * 1000 || saved.savedAt > now) return defaults;
    for (const key of Object.keys(emptyFilters)) {
      const value = saved.filters?.[key];
      if (typeof value === 'string' && value.length <= 120) defaults.filters[key] = value;
    }
    if (sortChoices.includes(saved.sort)) defaults.sort = saved.sort;
    return defaults;
  } catch { return defaults; }
}

export function savePreferences(storage, filters, sort) {
  try { storage.setItem(preferenceKey, JSON.stringify({filters,sort,savedAt:Date.now()})); } catch { /* Browsing still works when storage is unavailable. */ }
}

export function sortedCars(cars, sort) {
  const result = [...cars];
  const field = sort === 'year-new' ? 'year' : 'price';
  const direction = sort === 'price-low' ? 1 : -1;
  if (!sortChoices.includes(sort) || sort === 'latest') return result;
  return result.sort((a,b) => {
    const av = a[field] == null ? NaN : Number(a[field]);
    const bv = b[field] == null ? NaN : Number(b[field]);
    if (!Number.isFinite(av)) return Number.isFinite(bv) ? 1 : 0;
    if (!Number.isFinite(bv)) return -1;
    return direction * (av - bv);
  });
}
