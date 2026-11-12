import {t,localizedURL} from './i18n.mjs';
import {customerTranslations} from './customer-translations.mjs';

const supported=new Set(['en','ms','zh']);
export const customerLanguageKey='e2-customer-language';
export function chooseCustomerLanguage(href,stored='en'){
  const explicit=new URL(href,'https://e2auto.my/').searchParams.get('lang');
  return supported.has(explicit)?explicit:supported.has(stored)?stored:'en';
}
let stored='en';try{stored=globalThis.localStorage?.getItem(customerLanguageKey)||'en'}catch{}
export const customerLanguage=chooseCustomerLanguage(globalThis.location?.href||'https://e2auto.my/',stored);
export function ct(source,values={},lang=customerLanguage){
  const translated=lang==='en'?source:customerTranslations[source]?.[lang==='ms'?0:1]??t(source,{},lang);
  return String(translated).replace(/\{(\w+)\}/g,(match,key)=>Object.hasOwn(values,key)?String(values[key]):match);
}
export function accountURL(value,lang=customerLanguage,base=globalThis.location?.href||'https://e2auto.my/'){
  const url=new URL(localizedURL(value,lang,base));
  if(url.origin===new URL(base).origin&&/^\/(customer|saved)\.html$/.test(url.pathname))url.searchParams.set('lang',supported.has(lang)?lang:'en');
  return url.href;
}
export function rememberCustomerLanguage(lang){
  if(supported.has(lang))try{localStorage.setItem(customerLanguageKey,lang)}catch{}
}
// Translate only the trusted initial template, before account data is loaded.
// Input values and option values remain the original database values.
export function setupCustomerLanguage(){
  rememberCustomerLanguage(customerLanguage);
  document.documentElement.lang=customerLanguage==='zh'?'zh-Hans':customerLanguage;
  document.querySelectorAll('option:not([value])').forEach(option=>option.value=option.textContent);
  const walker=document.createTreeWalker(document.documentElement,NodeFilter.SHOW_TEXT);
  const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
  for(const node of nodes){
    if(node.parentElement.closest('script,style,textarea,[data-language]'))continue;
    const raw=node.nodeValue,source=raw.trim();if(source)node.nodeValue=raw.replace(source,ct(source));
  }
  for(const el of document.querySelectorAll('[aria-label],[title],[placeholder]')){
    for(const attr of ['aria-label','title','placeholder'])if(el.hasAttribute(attr))el.setAttribute(attr,ct(el.getAttribute(attr)));
  }
  for(const link of document.querySelectorAll('a[href]')){
    const raw=link.getAttribute('href');if(raw.startsWith('#'))continue;
    const target=new URL(raw,location.href);
    if(target.origin===location.origin&&/^\/(?:ms\/|zh\/)?(?:customer|saved|showroom|index|car|booking|plates|sales-team)\.html$/.test(target.pathname))link.href=accountURL(raw);
  }
  const switcher=document.createElement('nav');switcher.className='customerLanguages';switcher.setAttribute('aria-label',ct('Language'));
  for(const [lang,label] of [['ms','BM'],['en','EN'],['zh','华语']]){
    const link=document.createElement('a');
    // Do not copy auth fragments, invitation codes or recovery parameters.
    const url=new URL(location.pathname,location.origin);url.searchParams.set('lang',lang);
    if(new URLSearchParams(location.search).get('mode')==='register')url.searchParams.set('mode','register');
    link.href=url.href;link.textContent=label;link.lang=lang==='zh'?'zh-Hans':lang;
    link.setAttribute('aria-current',lang===customerLanguage?'page':'false');switcher.append(link);
  }
  document.querySelector('.customerNav')?.append(switcher);
}
