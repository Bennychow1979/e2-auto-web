import {ct,accountURL,customerLanguage,setupCustomerLanguage} from './customer-language.mjs?v=flow-20261113';
import {escapeHTML} from './i18n.mjs';
import {documentCoverage} from './document-fields.js';
import {sections} from './loan-fields.js';
const fieldLabels=new Map(sections({guarantor:'Yes'}).flat().map(([key,label])=>[key,label]));
export function ft(source,values={},lang=customerLanguage){
 const match=/^(Unknown application field|Invalid field format|Complete|Field is too long|Choose a valid option|Enter a whole positive number|Number outside range): ([a-z][a-z0-9_]*)$/.exec(String(source));
 if(match)return ct(match[1]+': {field}',{field:ct(fieldLabels.get(match[2])||match[2],{},lang)},lang);
 const translated=ct(source,values,lang);
 return lang==='en'&&values.count!==undefined?translated.replace(/file\(s\)/g,Number(values.count)===1?'file':'files'):translated;
}
export const flowURL=accountURL;
export const flowLocale=customerLanguage==='zh'?'zh-MY':customerLanguage==='ms'?'ms-MY':'en-MY';

// This tag translates source-code text only. Interpolated customer data, file
// names, staff notes and rendered child components never enter the translator.
// Callers must keep escaping data exactly as in their existing HTML renderers.
export function flowHTML(strings,...values){
 const marker=i=>`\uE000${i}\uE001`;
 const source=strings.reduce((out,part,i)=>out+(i?marker(i-1):'')+part,'');
 const translate=value=>value.split(/(\uE000\d+\uE001)/).map(part=>{
  if(/^\uE000/.test(part)||!part.trim())return part;
  const raw=part.trim(),decoded=raw.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'");
  const result=ft(decoded);return result===decoded?part:part.replace(raw,escapeHTML(result));
 }).join('');
 const template=source.split(/(<[^>]+>)/g).map(part=>part.startsWith('<')
  ?part.replace(/\b(aria-label|title|placeholder|alt)="([^"]*)"/g,(_,key,value)=>`${key}="${translate(value)}"`)
  :translate(part)).join('');
 const html=template.replace(/\uE000(\d+)\uE001/g,(_,i)=>String(values[Number(i)]??''));
 return html.replace(/\bhref="([^\"]+)"/g,(whole,href)=>{
  if(!/^(?:\/?(?:customer|saved|my-e2|documents|intake|customer-privacy|loan-privacy|intake-privacy|showroom|car|booking|index)\.html)(?:[?#]|$)/.test(href))return whole;
  return `href="${escapeHTML(flowURL(href.replace(/&amp;/g,'&')))}"`;
 });
}
export function setupCustomerFlow(){setupCustomerLanguage();document.body.classList.add('customerFlow');}

export function documentHint(hint){
 const match=/^Latest (\d+) (months(?: including the (?:current month|month of checklist selection) · show (commission|salary) credited to your personal bank account)?|months · business \/ company account|completed months before checklist selection)$/.exec(hint);
 if(!match)return ft(hint);
 return ft(hint.replace(match[1],'{count}').replace(/(commission|salary)(?= credited)/,'{income}'),{count:match[1],income:ft(match[3]||'')});
}
export function documentProgress(item,rows,now=new Date()){
 const c=documentCoverage(item,rows,now);
 return item.months?ft('{count} / {total} months uploaded',{count:c.months,total:item.months})+(c.missing.length?' · '+ft('Missing: {months}',{months:c.missing.join(', ')}):''):ft('{count} file(s) uploaded',{count:c.files});
}
export function documentSummary(items,rows,requirements){
 if(!items.length)return ft('Choose the applicant type to see required uploads.');
 const date=requirements?.status==='selected'?new Date(requirements.selected_at):new Date();
 const missing=items.filter(i=>!documentCoverage(i,rows,date).complete);
 return missing.length?ft('Missing uploads: {items}.',{items:missing.map(i=>ft(i.label)).join(', ')}):ft('Required uploads received. Staff verification is still needed.');
}
export function documentNotice(requirements){
 if(requirements?.status==='selected')return ft("Selected institution: {institution}. These are this application's saved requirements. Uploaded files still need staff verification; this is not loan approval.",{institution:requirements.institution});
 if(requirements?.status==='review_required')return ft('Institution requirements need staff review ({institution}). Showing the general applicant checklist; institution compliance is not confirmed.',{institution:requirements.institution});
 return ft('General applicant checklist. An employee will select a confirmed institution. Uploading these files does not confirm that institution requirements have been met.');
}
