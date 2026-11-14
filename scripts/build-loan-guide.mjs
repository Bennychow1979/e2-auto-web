import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {escapeHTML as e,LANGUAGES} from '../i18n.mjs';
import {loanGuidePaths} from '../loan-guide-routes.mjs';
import {publicPageShell} from './public-page-shell.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),origin='https://e2auto.my';
const json=value=>JSON.stringify(value).replace(/</g,'\\u003c');
// Deliberately limited to the reviewed document's headings, paragraphs, lists and table.
export function staticBlocks(markdown){
 const lines=markdown.trim().split('\n'),out=[];
 for(let i=0;i<lines.length;){
  const line=lines[i].trim();if(!line){i++;continue;}
  if(line.startsWith('## ')){out.push('<h2>'+e(line.slice(3))+'</h2>');i++;continue;}
  if(line.startsWith('|')){
   const rows=[];while(i<lines.length&&lines[i].startsWith('|'))rows.push(lines[i++].split('|').slice(1,-1).map(v=>v.trim()));
   if(rows.length!==7||rows.some(r=>r.length!==3)||!rows[1].every(v=>/^[-:]+$/.test(v)))throw Error('Unexpected approved loan comparison table');
   out.push('<div class="loanTableScroll" tabindex="0"><table><thead><tr>'+rows[0].map(v=>'<th scope="col">'+e(v)+'</th>').join('')+'</tr></thead><tbody>'+rows.slice(2).map(row=>'<tr>'+row.map((v,j)=>j?'<td>'+e(v)+'</td>':'<th scope="row">'+e(v)+'</th>').join('')+'</tr>').join('')+'</tbody></table></div>');continue;
  }
  if(/^(?:- |\d+\. )/.test(line)){
   const ordered=/^\d/.test(line),pattern=ordered?/^\d+\. /:/^- /,items=[];
   while(i<lines.length&&pattern.test(lines[i]))items.push(lines[i++].replace(pattern,''));
   const tag=ordered?'ol':'ul';out.push('<'+tag+'>'+items.map(v=>'<li>'+e(v)+'</li>').join('')+'</'+tag+'>');continue;
  }
  if(/^(?:#|\*\*|\[)/.test(line))throw Error('Unparsed approved loan content: '+line);
  const paragraph=[line];i++;while(i<lines.length&&lines[i].trim()&&!/^(?:## |\||- |\d+\. )/.test(lines[i]))paragraph.push(lines[i++].trim());
  out.push('<p>'+e(paragraph.join('\n'))+'</p>');
 }
 return out.join('\n');
}
export function parseApprovedLoan(source){
 const normalized=source.replace(/\r\n/g,'\n'),sections=normalized.split(/\n---\n/).slice(1),result={};
 if(sections.length!==3)throw Error('Expected three approved loan translations');
 for(const [i,lang]of ['ms','en','zh'].entries()){
  const section=sections[i].trim(),title=/^Title：(.+)$/m.exec(section)?.[1],description=/^Meta description：(.+)$/m.exec(section)?.[1],heading=/^# (.+)$/m.exec(section)?.[1];
  const faqHeading={ms:'Soalan lazim',en:'Common questions',zh:'常见问题'}[lang],faqMarker='\n## '+faqHeading+'\n';
  const content=section.slice(section.indexOf('\n# ')+1),body=content.slice(content.indexOf('\n')+1,content.indexOf(faqMarker)).trim(),tail=content.split(faqMarker)[1];
  if(!title||!description||!heading||!tail)throw Error('Incomplete approved loan copy: '+lang);
  const buttonLine=tail.split('\n').find(line=>line.startsWith('[WhatsApp'));
  if(!buttonLine)throw Error('Approved loan actions missing');
  const faqText=tail.slice(0,tail.indexOf(buttonLine)),faq=[...faqText.matchAll(/\*\*(.+?)\*\*\n([^\n]+)/g)].map(([,question,answer])=>({question,answer}));
  if(faq.length!==9)throw Error('Expected all nine approved loan FAQs');
  const remainder=faqText.replace(/\*\*(.+?)\*\*\n([^\n]+)/g,'').trim();if(remainder)throw Error('Unparsed FAQ text');
  const buttons=[...buttonLine.matchAll(/\[([^\]]+)\]/g)].map(m=>m[1]);if(buttons.length!==4)throw Error('Expected four approved actions');
  const closing=tail.slice(tail.indexOf(buttonLine)+buttonLine.length).trim().split('\n');
  result[lang]={path:loanGuidePaths[lang],title,description,heading,body,faqHeading,faq,buttons,closing};
 }
 return result;
}
export function loanAlternates(tag='link'){
 const paths={en:loanGuidePaths.en,ms:loanGuidePaths.ms,'zh-Hans':loanGuidePaths.zh,'x-default':loanGuidePaths.ms};
 return Object.entries(paths).map(([lang,path])=>'<'+tag+' rel="alternate" hreflang="'+lang+'" href="'+origin+path+'"'+(tag==='link'?'>':'/>')).join('');
}
export function renderLoanGuide(copy,homepage,lang,categories=[]){
 const shell=publicPageShell(homepage,lang,loanGuidePaths,categories),prefix=lang==='en'?'':'/'+lang;
 const faq={'@context':'https://schema.org','@type':'FAQPage',mainEntity:copy.faq.map(v=>({'@type':'Question',name:v.question,acceptedAnswer:{'@type':'Answer',text:v.answer}}))};
 const actions=['https://wa.me/60122785126',prefix+'/showroom.html#cars',prefix+'/booking.html','/my-e2.html?lang='+lang];
 const skip={en:'Skip to loan guide',ms:'Langkau ke panduan pinjaman',zh:'跳至贷款指南'}[lang];
 return '<!doctype html><html lang="'+(lang==='zh'?'zh-Hans':lang)+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+e(copy.title)+'</title><meta name="description" content="'+e(copy.description)+'"><link rel="canonical" href="'+origin+copy.path+'">'+loanAlternates()+shell.styles+'<link rel="stylesheet" href="/loan-guide.css?v=1"><script type="application/ld+json" id="loanFAQ">'+json(faq)+'</script><script src="/e2-config.js"></script><script type="module" src="/customer-nav.js?v=customer-language-20261112"></script><script type="module" src="/language-switcher.js?v=loan-guide-20261115"></script></head><body id="top" class="loanGuidePage"><a class="skip" href="#loanGuide">'+skip+'</a>'+shell.header+'<main id="loanGuide" class="loanGuide"><article><h1>'+e(copy.heading)+'</h1>'+staticBlocks(copy.body)+'<section class="loanFAQ"><h2>'+e(copy.faqHeading)+'</h2>'+copy.faq.map(v=>'<details><summary>'+e(v.question)+'</summary><p>'+e(v.answer)+'</p></details>').join('\n')+'</section><nav class="loanActions">'+actions.map((href,i)=>'<a href="'+e(href)+'"'+(i===0?' class="primary"':'')+'>'+e(copy.buttons[i])+'</a>').join('')+'</nav><div class="loanLocation">'+copy.closing.map(v=>'<p>'+e(v)+'</p>').join('')+'</div></article></main>'+shell.footer+'</body></html>\n';
}
export async function buildLoanGuides(output,{source=root,categories=[]}={}){
 const [homepage,approved]=await Promise.all([readFile(join(source,'index.html'),'utf8'),readFile(join(source,'templates/loan/approved-20261115.md'),'utf8')]),copy=parseApprovedLoan(approved);
 for(const lang of LANGUAGES){const path=join(output,loanGuidePaths[lang].slice(1),'index.html');await mkdir(dirname(path),{recursive:true});await writeFile(path,renderLoanGuide(copy[lang],homepage,lang,categories));}
}
