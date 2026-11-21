import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {LANGUAGES,languageTags,escapeHTML as e} from '../i18n.mjs';
import {carLoanPath,carLoanCopy} from '../car-loan-copy.mjs';
import {loanGuidePaths} from '../loan-guide-routes.mjs';
import {publicPageShell} from './public-page-shell.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export function renderCarLoan(homepage,lang,categories=[]){
 const c=carLoanCopy[lang],paths=Object.fromEntries(LANGUAGES.map(l=>[l,carLoanPath(l)]));
 const {header,footer,styles}=publicPageShell(homepage,lang,paths,categories);
 const input=(name,label,value,min,max,step='0.01')=>`<label for="cl-${name}-input">${e(label)}<input id="cl-${name}-input" name="${name}" type="number" inputmode="decimal" required min="${min}" max="${max}" step="${step}" value="${value}"${name==='rate'?' aria-describedby="cl-rate-help"':''}></label>`;
 return `<!doctype html><html lang="${lang==='zh'?'zh-Hans':lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#f5f5f2">
<title>${e(c.title)}</title><meta name="description" content="${e(c.description)}"><link rel="canonical" href="https://e2auto.my${paths[lang]}">
${LANGUAGES.map(l=>`<link rel="alternate" hreflang="${languageTags[l]}" href="https://e2auto.my${paths[l]}">`).join('')}<link rel="alternate" hreflang="x-default" href="https://e2auto.my${paths.en}">
${styles}<link rel="stylesheet" href="/car-loan-calculator.css?v=20261121"><script src="/e2-config.js"></script><script type="module" src="/customer-nav.js?v=customer-language-20261112"></script><script type="module" src="/language-switcher.js?v=car-loan-20261121"></script><script type="module" src="/car-loan-calculator.js?v=20261121c"></script></head>
<body id="top" class="carLoanPage"><a class="skip" href="#carLoanMain">${e(c.skip)}</a>${header}<main class="cl" id="carLoanMain"><span class="cl-kicker">${e(c.kicker)}</span><h1>${e(c.heading)}</h1><p class="cl-lead">${e(c.lead)}</p>
<noscript><p class="cl-noscript">${e({en:'Enable JavaScript to calculate. The formula and financing information remain available below.',ms:'Aktifkan JavaScript untuk mengira. Formula dan maklumat pembiayaan tersedia di bawah.',zh:'请开启 JavaScript 使用计算器。下方仍可查看计算公式和贷款说明。'}[lang])}</p></noscript>
<div class="cl-grid"><form class="cl-card" id="cl-form" data-calculator-language="${lang}" novalidate><div class="cl-fields">
${input('price',c.price,50000,0.01,10000000)}${input('deposit',c.deposit,5000,0,10000000)}${input('rate',c.rate,3.5,0,30,'0.001')}
<label for="cl-years-input">${e(c.years)}<select id="cl-years-input" name="years">${Array.from({length:9},(_,i)=>`<option value="${i+1}"${i===6?' selected':''}>${i+1}</option>`).join('')}</select></label></div><p class="cl-help" id="cl-rate-help">${e(c.rateHelp)}</p><p class="cl-help">${e(c.example)}</p><div class="cl-actions"><button type="submit">${e(c.calculate)}</button><button type="reset">${e(c.reset)}</button></div></form>
<section class="cl-card cl-result" aria-live="polite" aria-atomic="true"><p class="cl-error" id="cl-error" role="status" hidden></p><div id="cl-result" hidden><h2>${e(c.result)}</h2><span>${e(c.monthly)}</span><strong class="cl-monthly" id="cl-monthly"></strong><span>${e(c.perMonth)}</span> · <span id="cl-months"></span><dl>${['principal'].map(key=>`<div><dt>${e(c[key])}</dt><dd id="cl-${key}"></dd></div>`).join('')}</dl></div></section></div>
<p class="cl-note">${e(c.note)}</p><div class="cl-actions"><a class="cl-link" href="/${lang==='en'?'':lang+'/'}showroom.html#cars">${e(c.browse)}</a><a class="cl-link secondary" href="${loanGuidePaths[lang]}">${e(c.financing)}</a><a class="cl-link secondary" href="/${lang==='en'?'':lang+'/'}roadtax-calculator/">${e(c.roadtax)}</a></div>
<section class="cl-info"><h2>${e(c.how)}</h2><p>${e(c.formula)}</p></section><section class="cl-info"><h2>${e(c.faq)}</h2>${c.questions.map(([q,a])=>`<details><summary>${e(q)}</summary><p>${e(a)}</p></details>`).join('')}</section></main>${footer}</body></html>\n`;
}
export async function buildCarLoanPages(output,{source=root,categories=[]}={}){
 const homepage=await readFile(join(source,'index.html'),'utf8');
 for(const lang of LANGUAGES){const file=join(output,carLoanPath(lang).slice(1),'index.html');await mkdir(dirname(file),{recursive:true});await writeFile(file,renderCarLoan(homepage,lang,categories));}
}
