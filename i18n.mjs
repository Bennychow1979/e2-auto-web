import {translations} from './translations.mjs';
export const LANGUAGES = ['en','ms','zh'];
export const languageTags = {en:'en-MY',ms:'ms-MY',zh:'zh-Hans-MY'};
export const languageFromPath = path => /^\/(ms|zh)(?:\/|$)/.exec(path || '')?.[1] || 'en';
export const language = languageFromPath(globalThis.location?.pathname);
export const publicPageNames = new Set(['','index.html','showroom.html','car.html']);
export function t(source, values = {}, lang = language) {
  const raw = String(source ?? '');
  let result = lang === 'en' ? raw : translations[raw]?.[lang === 'ms' ? 0 : 1];
  if(result === undefined) {
    const decorated = /^(←\s*|♡\s*|♥\s*)?(.+?)(\s*[↗↓])?$/.exec(raw);
    const translated = decorated && translations[decorated[2]]?.[lang === 'ms' ? 0 : 1];
    result = translated === undefined ? raw : (decorated[1] || '') + translated + (decorated[3] || '');
    const years = /^(\d+) years$/.exec(raw);
    if(years && lang !== 'en') result = translations['{count} years'][lang === 'ms' ? 0 : 1].replace('{count}',years[1]);
  }
  return result.replace(/\{(\w+)\}/g,(match,key)=>Object.hasOwn(values,key)?String(values[key]):match);
}
export function localizedURL(value, lang = language, base = globalThis.location?.href || 'https://e2auto.my/') {
  const url = new URL(value,base), origin = new URL(base).origin;
  if(url.origin !== origin) return url.href;
  const clean = url.pathname.replace(/^\/(ms|zh)(?=\/|$)/,'').replace(/^\//,'');
  if(publicPageNames.has(clean)) url.pathname = '/' + (lang === 'en' ? '' : lang + '/') + (clean === 'index.html' ? '' : clean);
  else url.pathname = '/' + clean;
  return url.href;
}
export function escapeHTML(value) {return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
// Translate trusted UI templates, never database content or user inputs.
export function translateHTML(html, lang = language) {
  let skip = false;
  return html.split(/(<[^>]+>)/g).map(part=>{
    if(part.startsWith('<')) {
      if(/^<(script|style)\b/i.test(part))skip=true;
      if(/^<\/(script|style)/i.test(part))skip=false;
      if(skip)return part;
      return part.replace(/\b(aria-label|placeholder|title)="([^"]*)"/g,(_,attr,value)=>attr+'="'+escapeHTML(t(value,{},lang))+'"');
    }
    if(skip || !part.trim())return part;
    const raw=part.trim(), source=raw.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'");
    const translated=t(source,{},lang);
    return translated===source?part:part.replace(raw,escapeHTML(translated));
  }).join('');
}
export function localizedMileage(car) {
  return car.mileage === null ? t('Pending confirmation') : Number(car.mileage).toLocaleString('en-MY')+' km'+(car.mileage_confirmed?'':t(' · pending confirmation'));
}
