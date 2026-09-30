import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {LANGUAGES,languageTags,translateHTML,publicPageNames,escapeHTML,t} from '../i18n.mjs';
const origin='https://e2auto.my/';
export const homeMetadata={
 en:{title:'Used Cars KL & Selangor | E2 Auto Batu Caves',description:'Browse used cars for KL and Selangor at E2 Auto. See real photos and specifications, estimate monthly payments and visit our Batu Caves showroom.'},
 ms:{title:'Kereta Terpakai KL & Selangor | E2 Auto Batu Caves',description:'Cari kereta terpakai untuk KL dan Selangor di E2 Auto. Lihat foto dan spesifikasi, anggarkan ansuran dan lawati bilik pameran Batu Caves.'},
 zh:{title:'吉隆坡／雪兰莪二手车 | E2 Auto Batu Caves',description:'在 E2 Auto 寻找吉隆坡与雪兰莪二手车。浏览实车照片和规格、估算每月供款，预约到访 Batu Caves 展厅。'}
};
export function homeAlternates(){return [...LANGUAGES.map(lang=>'<link rel="alternate" hreflang="'+languageTags[lang]+'" href="'+origin+(lang==='en'?'':lang+'/')+'">'),'<link rel="alternate" hreflang="x-default" href="'+origin+'">'].join('');}
export function localizedPage(source,file,lang){
 let html=source;
 // Option values must remain the database / form values after labels change.
 html=html.replace(/<option(?![^>]*\bvalue=)([^>]*)>([^<]*)<\/option>/g,(_,attrs,label)=>'<option value="'+escapeHTML(label)+'"'+attrs+'>'+label+'</option>');
 html=translateHTML(html,lang).replace('<html lang="en">','<html lang="'+(lang==='zh'?'zh-Hans':lang)+'">');
 // Localized pages live one directory below the existing assets and private workspaces.
 html=html.replace(/\b(href|src)="([^"#?][^"]*)"/g,(whole,attr,value)=>{
  if(value.startsWith('https://wa.me/')){
   const url=new URL(value.replace(/&amp;/g,'&'));
   if(url.searchParams.has('text'))url.searchParams.set('text',t(url.searchParams.get('text'),{},lang));
   return attr+'="'+escapeHTML(url.href)+'"';
  }
  if(/^(?:[a-z]+:|\/)/i.test(value))return whole;
  const path=value.split(/[?#]/)[0];
  if(attr==='href' && publicPageNames.has(path))return attr+'="'+value+'"';
  if(value.startsWith('ms/')||value.startsWith('zh/'))return attr+'="/'+value+'"';
  return attr+'="../'+value+'"';
 });
 // Always render usable language links even before JavaScript loads.
 html=html.replace(/<a ([^>]*data-language="(en|ms|zh)"[^>]*)>[^<]*<\/a>/g,(_,attrs,target)=>{
  const href='/' +(target==='en'?'':target+'/')+(file==='car.html'?'car.html':'');
  const fixed=attrs.replace(/href="[^"]*"/,'href="'+href+'"').replace(/aria-current="[^"]*"/,'aria-current="'+(target===lang?'page':'false')+'"');
  return '<a '+fixed+'>'+({en:'EN',ms:'BM',zh:'华语'}[target])+'</a>';
 });
 if(file!=='car.html'){
  const meta=homeMetadata[lang];
  html=html.replace(/<title>[^<]*<\/title>/,'<title>'+escapeHTML(meta.title)+'</title>')
   .replace(/(<meta (?:name="description"|property="og:description") content=")[^"]*"/g,'$1'+escapeHTML(meta.description)+'"')
   .replace(/(<meta property="og:title" content=")[^"]*"/,'$1'+escapeHTML(meta.title)+'"')
   .replace(/(<link rel="canonical" href=")[^"]*"/,'$1'+origin+lang+'/"')
   .replace(/(<meta property="og:url" content=")[^"]*"/,'$1'+origin+lang+'/"');
 }else{
  const descriptions={ms:'Lihat foto dan spesifikasi kereta terpakai E2 Auto. Anggarkan ansuran dan atur lawatan ke Batu Caves untuk pelanggan KL dan Selangor.',zh:'浏览 E2 Auto 二手车照片与规格、估算每月供款，预约到访 Batu Caves 展厅。服务吉隆坡与雪兰莪客户。'};
  html=html.replace(/(<meta name="description" content=")[^"]*"/,'$1'+descriptions[lang]+'"');
 }
 return html;
}
export async function buildLanguages(){
 const root=new URL('../',import.meta.url);
 for(const lang of ['ms','zh']){
  await mkdir(new URL(lang+'/',root),{recursive:true});
  for(const file of ['index.html','showroom.html','car.html']){
   await writeFile(new URL(lang+'/'+file,root),localizedPage(await readFile(new URL(file,root),'utf8'),file,lang));
  }
 }
 console.log('Built BM and 华语 homepages, showroom aliases and vehicle pages.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await buildLanguages();
