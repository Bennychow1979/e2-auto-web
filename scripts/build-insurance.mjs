import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {LANGUAGES} from '../i18n.mjs';
import {insurancePaths} from '../insurance-routes.mjs';
import {publicPageShell} from './public-page-shell.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export function insuranceParts(source){
 const block=name=>{
  const match=source.match(new RegExp('<!-- E2 INSURANCE'+name+' START[^>]*-->([\\s\\S]*?)<!-- E2 INSURANCE'+name+' END -->'));
  if(!match)throw Error('Missing supplied insurance block: '+name);
  return match[1];
 };
 const metadata=[source.match(/<title>[\s\S]*?<\/title>/)?.[0],source.match(/<meta name="description"[^>]*>/)?.[0],source.match(/<link rel="canonical"[^>]*>/)?.[0],...(source.match(/<link rel="alternate"[^>]*>/g)||[])];
 if(metadata.length!==7||metadata.some(v=>!v))throw Error('Incomplete insurance metadata');
 return {metadata:metadata.join('\n'),css:block(' CSS'),body:block(''),js:block(' JS')};
}
export function renderInsurance(source,homepage,lang,categories=[]){
 const parts=insuranceParts(source),{header,footer,styles}=publicPageShell(homepage,lang,insurancePaths,categories);
 const body=parts.body.replace('<main class="rt">','<main class="rt" id="insuranceMain">');
 const skip={en:'Skip to car insurance calculator',ms:'Langkau ke kalkulator insurans kereta',zh:'跳至汽车保险计算器'}[lang];
 return '<!doctype html><html lang="'+(lang==='zh'?'zh-Hans':lang)+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f5f5f2">\n'+parts.metadata+'\n'+styles+parts.css+'<link rel="stylesheet" href="/roadtax-site.css?v=1"><script src="/e2-config.js"></script><script type="module" src="/customer-nav.js?v=customer-language-20261112"></script><script type="module" src="/language-switcher.js?v=insurance-20261118"></script></head><body id="top" class="roadtaxPage insurancePage"><a class="skip" href="#insuranceMain">'+skip+'</a>'+header+body+footer+parts.js+'</body></html>\n';
}
export async function buildInsurancePages(output,{source=root,categories=[]}={}){
 const homepage=await readFile(join(source,'index.html'),'utf8');
 for(const lang of LANGUAGES){
  const provided=await readFile(join(source,'templates','insurance',lang+'.html'),'utf8');
  const path=join(output,insurancePaths[lang].slice(1),'index.html');
  await mkdir(dirname(path),{recursive:true});await writeFile(path,renderInsurance(provided,homepage,lang,categories));
 }
}
