// Number plates for sale: synthetic workbooks only.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import ExcelJS from 'exceljs';
import {extractPlateSales,diffPlates,renderPlatesPage} from '../../scripts/plate-sales-core.mjs';
import {run} from '../../scripts/plate-sales.mjs';
import {localizedPage} from '../../scripts/build-languages.mjs';
import {renderSitemap} from '../../scripts/build-sitemap.mjs';
import {t} from '../../i18n.mjs';

const when={year:2026,month:10};
const header=['BTC BRANCH','NO','NoPlate','Brand','Model','YRS','CC','A/M','COST','COLOR','PROFIT','MUDAH PRICE','DATE IN'];
// Vehicle rows, then the plate block at a chosen row, then another block below it.
function book({sheet='OCT',gap=5,block=[['ALN56',18888],['BQU2828',8888]],marker='PLATE FOR SALES',markerCol=3,extra}={}) {
  const w=new ExcelJS.Workbook(),s=w.addWorksheet(sheet);
  s.addRow(header);
  for(let i=0;i<gap;i++)s.addRow(['BTC BRANCH',i+1,'VAB'+(100+i),'PROTON','SAGA',2019,'1.3','A',20000,'WHITE',5000,30000,new Date('2026-10-01')]);
  s.addRow([]);
  const m=s.addRow([]);m.getCell(markerCol).value=marker;
  for(const [plate,price] of block)s.addRow(['BTC BRANCH',1,plate,null,null,null,null,null,null,null,null,price]);
  s.addRow([]);s.addRow(['','', 'PENDING DELIVERY / DONE SIGN LOAN']);s.addRow(['BTC BRANCH',1,'WXY9999','HONDA','CITY',2018,'1.5','A',30000,'RED',4000,40000]);
  extra?.(s,w);
  return w;
}
const keys=o=>Object.keys(o).sort().join(',');

test('reads only number and price from the block, wherever it sits in the current month',()=>{
  for(const gap of [3,40]) {
    const r=extractPlateSales(book({gap}),when);
    assert.deepEqual(r.plates,[{plate:'ALN56',price:18888},{plate:'BQU2828',price:8888}]);
    assert.deepEqual(r.issues,[]);assert.equal(r.firstRow,gap+4);
    assert(r.plates.every(p=>keys(p)==='plate,price'),'No other sheet columns leave the parser');
  }
  // Text prices with RM and commas are accepted; the marker is matched case-insensitively.
  const r=extractPlateSales(book({marker:'Plate for sale',block:[['vbr 1888','RM8,888'],['VRH321','1888']]}),when);
  assert.deepEqual(r.plates,[{plate:'VBR 1888',price:8888},{plate:'VRH321',price:1888}]);
});

test('stops at the first blank row and never reads the next block or older months',()=>{
  const r=extractPlateSales(book({extra:(s,w)=>{const sep=w.addWorksheet('SEPT');sep.addRow(header);sep.addRow(['','','PLATE FOR SALES']);sep.addRow(['','','OLD1',...Array(8).fill(null),99])}}),when);
  assert(!r.plates.some(p=>p.plate==='WXY9999'||p.plate==='OLD1'));assert.equal(r.sheet,'OCT');
});

test('duplicates and abnormal prices are held back for review, never overwritten',()=>{
  const r=extractPlateSales(book({block:[['ALN56',18888],['ALN 56',17000],['VRH321',0],['VBR1888',8888.5],['WAA1','TBA'],['WAA2',{formula:'1+1',result:2}],['WAA3',2000000],['WAA4',null],['GOOD1',100]]}),when);
  assert.deepEqual(r.plates,[{plate:'GOOD1',price:100}]);
  const flagged=r.issues.map(i=>i.plate);
  for(const p of ['ALN56','ALN 56','VRH321','VBR1888','WAA1','WAA2','WAA3','WAA4'])assert(flagged.includes(p),p+' must need review');
  assert(r.issues.filter(i=>/Duplicate/.test(i.issue)).length===2);
});

test('missing, repeated or misplaced markers stop the check',()=>{
  assert.match(extractPlateSales(book({marker:'PLATES'}),when).issues[0].issue,/not found/);
  const twice=extractPlateSales(book({extra:s=>{s.addRow([]);s.addRow(['','','PLATE FOR SALES'])}}),when);
  assert.match(twice.issues[0].issue,/More than one/);assert.deepEqual(twice.plates,[]);
  assert(extractPlateSales(book({markerCol:2}),when).issues.some(i=>/not in the No Plate column/.test(i.issue)));
  const noPrice=new ExcelJS.Workbook();noPrice.addWorksheet('OCT').addRow(['NoPlate','Brand']);
  assert.match(extractPlateSales(noPrice,when).issues[0].issue,/headers were not found/);
});

test('a listed number also used on a stock vehicle is reported, not guessed',()=>{
  const r=extractPlateSales(book({extra:s=>{s.getRow(3).getCell(3).value='BQU2828'}}),when);
  assert.deepEqual(r.plates.map(p=>p.plate),['ALN56','BQU2828']);
  assert.deepEqual(r.notes.map(n=>[n.row,n.plate]),[[3,'BQU2828']]);
});

test('page rendering escapes values, replaces only its region and keeps valid structured data',async()=>{
  const template=await readFile(new URL('../../plates.html',import.meta.url),'utf8');
  const html=renderPlatesPage(template,[{plate:'A<B>1',price:5}]);
  assert(html.includes('A&lt;B&gt;1')&&!html.includes('A<B>1'));
  const data=JSON.parse(/<script id="plateStructuredData" type="application\/ld\+json">([^<]*)<\/script>/.exec(html)[1]);
  assert.equal(data.itemListElement[0].item.offers.priceCurrency,'MYR');assert.equal(data.itemListElement[0].item.offers.price,'5');
  assert(renderPlatesPage(template,[]).includes('No number plates are listed right now.'));
  assert.equal(renderPlatesPage(renderPlatesPage(template,[{plate:'X1',price:1}]),[{plate:'X1',price:1}]),renderPlatesPage(template,[{plate:'X1',price:1}]),'Re-rendering is stable');
  assert.throws(()=>renderPlatesPage('<html></html>',[]),/generated plate list region/);
});

test('--write refuses while issues remain and leaves the published list unchanged',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'plates-')),dataFile=join(dir,'data.json'),pageFile=join(dir,'plates.html'),xlsx=join(dir,'m.xlsx');
  await copyFile(new URL('../../plates.html',import.meta.url),pageFile);
  await writeFile(dataFile,JSON.stringify({plates:[{plate:'ALN56',price:18888}]}));
  const before=[await readFile(dataFile,'utf8'),await readFile(pageFile,'utf8')],quiet=()=>{};
  await book({block:[['ALN56',18888],['ALN56',1]]}).xlsx.writeFile(xlsx);
  assert.equal((await run([xlsx,'--month=2026-10','--write'],quiet,{dataFile,pageFile})).written,false);
  assert.deepEqual([await readFile(dataFile,'utf8'),await readFile(pageFile,'utf8')],before);
  await book().xlsx.writeFile(xlsx);
  const preview=await run([xlsx,'--month=2026-10'],quiet,{dataFile,pageFile});
  assert.equal(preview.written,false);assert.deepEqual(preview.diff.added.map(p=>p.plate),['BQU2828']);
  assert.equal((await run([xlsx,'--month=2026-10','--write'],quiet,{dataFile,pageFile})).written,true);
  assert.deepEqual(JSON.parse(await readFile(dataFile,'utf8')).plates,[{plate:'ALN56',price:18888},{plate:'BQU2828',price:8888}]);
  assert((await readFile(pageFile,'utf8')).includes('>BQU2828<'));
  assert.deepEqual(diffPlates([{plate:'A1',price:1}],[{plate:'A1',price:2}]).repriced,[{plate:'A1',from:1,to:2}]);
});

test('BM and 华语 pages translate copy, enquiry messages, metadata and links',async()=>{
  const source=renderPlatesPage(await readFile(new URL('../../plates.html',import.meta.url),'utf8'),[{plate:'ALN56',price:18888}]);
  for(const lang of ['ms','zh']) {
    const html=localizedPage(source,'plates.html',lang);
    assert(html.includes('lang="'+(lang==='zh'?'zh-Hans':'ms')+'"'));
    assert(html.includes(t('Number plates for sale.',{},lang))&&html.includes(t('Asking price',{},lang)));
    assert(html.includes('<link rel="canonical" href="https://e2auto.my/'+lang+'/plates.html">'));
    assert(html.includes('href="../plates.css?v=1"')&&html.includes('aria-current="page">'+(lang==='ms'?'BM':'华语')+'</a>'));
    const link=/class="primary plateEnquiry"[^>]*href="([^"]*)"/.exec(html)[1].replace(/&amp;/g,'&');
    assert.equal(new URL(link).searchParams.get('text'),t('Hi E2 Auto, I am interested in number plate {plate} ({price}).',{plate:'ALN56',price:'RM18,888'},lang));
    assert(html.includes('>ALN56<')&&html.includes('RM18,888'));
  }
});

test('release sitemap lists the plate page in every language',()=>{
  const xml=renderSitemap([],{staticPages:true,slugs:{}});
  for(const path of ['plates.html','ms/plates.html','zh/plates.html'])assert(xml.includes('<loc>https://e2auto.my/'+path+'</loc>'));
  assert(!renderSitemap([]).includes('plates.html'),'Non-release sitemap is unchanged');
});
