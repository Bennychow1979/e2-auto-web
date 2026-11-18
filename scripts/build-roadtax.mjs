import {insurancePaths,insuranceLabels} from '../insurance-routes.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {LANGUAGES} from '../i18n.mjs';
import {publicPageShell} from './public-page-shell.mjs';

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
export function renderRoadtax(source,homepage,lang,categories=[]){
 const parts=roadtaxParts(source),paths=Object.fromEntries(LANGUAGES.map(l=>[l,roadtaxPath(l)]));
 const {header:pageHeader,footer:pageFooter,styles}=publicPageShell(homepage,lang,paths,categories);
 const body=parts.body.replace('<div class="rt-btns">','<div class="rt-btns"><a class="rt-btn" href="'+insurancePaths[lang]+'">'+insuranceLabels[lang]+'</a>').replace('<main class="rt">','<main class="rt" id="roadtaxMain">').replace('href="/showroom.html#cars"','href="/'+(lang==='en'?'':lang+'/')+'showroom.html#cars"');
 const skip={en:'Skip to road tax calculator',ms:'Langkau ke kalkulator cukai jalan',zh:'跳至路税计算器'}[lang];
 return '<!doctype html><html lang="'+(lang==='zh'?'zh-Hans':lang)+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f5f5f2">\n'+parts.metadata+'\n'+styles+parts.css+'<link rel="stylesheet" href="/roadtax-site.css?v=1"><script src="/e2-config.js"></script><script type="module" src="/customer-nav.js?v=customer-language-20261112"></script><script type="module" src="/language-switcher.js?v=roadtax-20261115"></script></head><body id="top" class="roadtaxPage"><a class="skip" href="#roadtaxMain">'+skip+'</a>'+pageHeader+body+pageFooter+parts.js+'</body></html>\n';
}
export async function buildRoadtaxPages(output,{source=root,categories=[]}={}){
 const homepage=await readFile(join(source,'index.html'),'utf8');
 for(const lang of LANGUAGES){
  const provided=await readFile(join(source,'templates','roadtax',lang+'.html'),'utf8');
  const path=join(output,roadtaxPath(lang).slice(1),'index.html');await mkdir(dirname(path),{recursive:true});await writeFile(path,renderRoadtax(provided,homepage,lang,categories));
 }
}
