import {t,localizedURL} from './i18n.mjs';
import {flowTranslations} from './customer-flow-translations.mjs';
import {privacyTranslations} from './customer-privacy-translations.mjs';
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
  const translated=lang==='en'?source:(customerTranslations[source]??flowTranslations[source]??privacyTranslations[source])?.[lang==='ms'?0:1]??t(source,{},lang);
  return String(translated).replace(/\{(\w+)\}/g,(match,key)=>Object.hasOwn(values,key)?String(values[key]):match);
}
export function accountURL(value,lang=customerLanguage,base=globalThis.location?.href||'https://e2auto.my/'){
  const url=new URL(localizedURL(value,lang,base));
  if(url.origin===new URL(base).origin&&/^\/(customer|saved|my-e2|documents|intake|customer-privacy|loan-privacy|intake-privacy)\.html$/.test(url.pathname))url.searchParams.set('lang',supported.has(lang)?lang:'en');
  return url.href;
}
export function rememberCustomerLanguage(lang){
  if(supported.has(lang))try{localStorage.setItem(customerLanguageKey,lang)}catch{}
}
export function customerSwitchURL(href,lang){
 const current=new URL(href),url=new URL(current.pathname,current.origin);
 url.searchParams.set('lang',supported.has(lang)?lang:'en');
 const params=current.searchParams;
 if(params.get('mode')==='register')url.searchParams.set('mode','register');
 const keys=current.pathname==='/my-e2.html'?['application','car','sales']:current.pathname==='/documents.html'?['application','staff']:current.pathname==='/intake.html'?['invite']:[];
 for(const key of keys)if(params.has(key))url.searchParams.set(key,params.get(key));
 return url.href;
}
export function refreshCustomerLanguageLinks(){
 for(const link of document.querySelectorAll('.customerLanguages a[data-customer-language]'))link.href=customerSwitchURL(location.href,link.dataset.customerLanguage);
}
// Translate only the trusted initial template, before account data is loaded.
// Input values and option values remain the original database values.
export function setupCustomerLanguage(){
  if(document.querySelector('.customerLanguages'))return;
  rememberCustomerLanguage(customerLanguage);
  document.documentElement.lang=customerLanguage==='zh'?'zh-Hans':customerLanguage;
  document.querySelectorAll('option:not([value])').forEach(option=>option.value=option.textContent);
  const walker=document.createTreeWalker(document.documentElement,NodeFilter.SHOW_TEXT);
  const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
  for(const node of nodes){
    if(node.parentElement.closest('script,style,textarea,[data-language],[data-original-language]'))continue;
    const raw=node.nodeValue,source=raw.trim();if(source)node.nodeValue=raw.replace(source,ct(source));
  }
  for(const el of document.querySelectorAll('[aria-label],[title],[placeholder]')){
    for(const attr of ['aria-label','title','placeholder'])if(el.hasAttribute(attr))el.setAttribute(attr,ct(el.getAttribute(attr)));
  }
  for(const link of document.querySelectorAll('a[href]')){
    const raw=link.getAttribute('href');if(raw.startsWith('#'))continue;
    const target=new URL(raw,location.href);
    if(target.origin===location.origin&&/^\/(?:ms\/|zh\/)?(?:customer|saved|my-e2|documents|intake|customer-privacy|loan-privacy|intake-privacy|showroom|index|car|booking|plates|sales-team)\.html$/.test(target.pathname))link.href=accountURL(raw);
  }
  const switcher=document.createElement('nav');switcher.className='customerLanguages';switcher.setAttribute('aria-label',ct('Language'));
  for(const [lang,label] of [['ms','BM'],['en','EN'],['zh','华语']]){
    const link=document.createElement('a');
    // Keep only page context needed to continue this application. Never copy auth tokens.
    link.href=customerSwitchURL(location.href,lang);link.dataset.customerLanguage=lang;link.textContent=label;link.lang=lang==='zh'?'zh-Hans':lang;
    link.setAttribute('aria-current',lang===customerLanguage?'page':'false');switcher.append(link);
  }
  document.querySelector('.customerNav,.siteHeader,[data-language-header]')?.append(switcher);
}
