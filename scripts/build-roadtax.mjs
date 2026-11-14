import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {LANGUAGES} from '../i18n.mjs';
import {localizedPage} from './build-languages.mjs';
import {categoryNavigation} from './build-discovery.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
export const roadtaxPath=lang=>'/'+(lang==='en'?'':lang+'/')+'roadtax-calculator/';
export function roadtaxParts(source){
 const block=name=>{
  const match=source.match(new RegExp('<!-- E2 ROADTAX'+name+' START[^>]*-->([\\s\\S]*?)<!-- E2 ROADTAX'+name+' END -->'));
  if(!match)throw Error('Missing supplied road tax block: '+name);
  return match[1];
 };
 const metadata=[source.match(/<title>[\s\S]*?<\/title>/)?.[0],source.match(/<meta name="description"[^>]*>/)?.[0],source.match(/<link rel="canonical"[^>]*>/)?.[0],...(source.match(/<link rel="alternate"[^>]*>/g)||[])];
 if(metadata.length!==7||metadata.some(v=>!v))throw Error('Incomplete road tax metadata');
 return {metadata:metadata.join('\n'),css:block(' CSS'),body:block(''),js:block(' JS')};
}
function rootLinks(html,lang){
 const home='/'+(lang==='en'?'':lang+'/'),base='https://e2auto.my'+home+'index.html';
 return html.replace(/\b(href|src)="([^\"]*)"/g,(whole,attr,value)=>{
  if(!value||/^(?:[a-z]+:|\/)/i.test(value))return whole;
  if(value.startsWith('#'))return attr+'="'+home+(value==='#top'?'':value)+'"';
  const url=new URL(value.replace(/&amp;/g,'&'),base);
  return attr+'="'+(url.pathname+url.search+url.hash).replace(/&/g,'&amp;')+'"';
 });
}
export function renderRoadtax(source,homepage,lang,categories=[]){
 const parts=roadtaxParts(source),shell=lang==='en'?homepage:localizedPage(homepage,'index.html',lang);
 const header=/<header\b[\s\S]*?<\/header>/.exec(shell)?.[0],footer=/<footer\b[\s\S]*?<\/footer>/.exec(shell)?.[0];
 if(!header||!footer)throw Error('Existing E2 page shell is required');
 const pageHeader=rootLinks(header,lang).replace(/<a ([^>]*data-language="(en|ms|zh)"[^>]*)>/g,(_,attrs,target)=>'<a '+attrs.replace(/href="[^\"]*"/,'href="'+roadtaxPath(target)+'"')+'>');
 const pageFooter=rootLinks(footer,lang).replace('</footer>',()=>categoryNavigation(categories,lang,{footer:true})+'</footer>');
 const head=/<head>([\s\S]*?)<\/head>/.exec(shell)[1];
 const styles=(head.match(/<link rel="(?:stylesheet|icon|apple-touch-icon)"[^>]*>|<style>[\s\S]*?<\/style>/g)||[]).join('\n');
 const body=parts.body.replace('<main class="rt">','<main class="rt" id="roadtaxMain">').replace('href="/showroom.html#cars"','href="/'+(lang==='en'?'':lang+'/')+'showroom.html#cars"');
 const skip={en:'Skip to road tax calculator',ms:'Langkau ke kalkulator cukai jalan',zh:'跳至路税计算器'}[lang];
 return '<!doctype html><html lang="'+(lang==='zh'?'zh-Hans':lang)+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f5f5f2">\n'+parts.metadata+'\n'+rootLinks(styles,lang)+parts.css+'<link rel="stylesheet" href="/roadtax-site.css?v=1"><script src="/e2-config.js"></script><script type="module" src="/customer-nav.js?v=customer-language-20261112"></script><script type="module" src="/language-switcher.js?v=roadtax-20261115"></script></head><body id="top" class="roadtaxPage"><a class="skip" href="#roadtaxMain">'+skip+'</a>'+pageHeader+body+pageFooter+parts.js+'</body></html>\n';
}
export async function buildRoadtaxPages(output,{source=root,categories=[]}={}){
 const homepage=await readFile(join(source,'index.html'),'utf8');
 for(const lang of LANGUAGES){
  const provided=await readFile(join(source,'templates','roadtax',lang+'.html'),'utf8');
  const path=join(output,roadtaxPath(lang).slice(1),'index.html');await mkdir(dirname(path),{recursive:true});await writeFile(path,renderRoadtax(provided,homepage,lang,categories));
 }
}
