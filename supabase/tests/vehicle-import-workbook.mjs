// Current-month workbook projection: parsing must match full ExcelJS while
// older months, column formatting and validations no longer cost CPU.
import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {SaxesParser} from 'saxes';
import {fixture,fakeWorld,when} from './import-fixture.mjs';
import {createWorkbookLoader,createRowCache} from '../functions/e2-vehicle-import/workbook.mjs';
import {runImport} from '../functions/e2-vehicle-import/run.mjs';
import {sourceRows} from '../functions/e2-vehicle-import/plan.mjs';
import {admitZip} from '../functions/e2-vehicle-import/xlsx-bounds.mjs';
const load=createWorkbookLoader({ExcelJS,JSZip,SaxesParser});
const full=async b=>{const w=new ExcelJS.Workbook();await w.xlsx.load(b);return w};
const wanted=new Set(['TEST1000','TEST1001','TEST1002']);
const project=w=>sourceRows(w,when,wanted);
async function serialized(w){return w.xlsx.writeBuffer()}

test('selected XLSX keeps current-month sale rows identical while omitting historical sheets',async()=>{
  const bytes=await serialized(fixture({months:12,rows:30,columns:20}));
  const all=await full(bytes),selected=await load(bytes,when);
  assert.equal(all.worksheets.length,12);assert.equal(selected.worksheets.length,1);
  assert.deepEqual(project(selected),project(all));
  assert(!JSON.stringify([...project(selected)]).includes('PRIVATE_SYNTHETIC'));
});
test('preserves date1904, rich text, duplicate rows, formulas, errors and hyperlink rejection',async()=>{
  for(const mode of ['date1904','rich','duplicate','formula','error','hyperlink','merge']) {
    const w=fixture({months:2,rows:3}),s=w.getWorksheet('OCT');
    if(mode==='date1904')w.properties.date1904=true;
    if(mode==='rich'){s.getCell('B2').value={richText:[{text:'TEST'},{text:'1000'}]};s.getCell('C2').value={richText:[{text:'BMW'}]}}
    if(mode==='duplicate')s.getCell('B3').value='TEST1000';
    if(mode==='formula')s.getCell('A2').value={formula:'1+1',result:50000};
    if(mode==='error')s.getCell('A2').value={error:'#N/A'};
    if(mode==='hyperlink')s.getCell('C2').value={text:'BMW',hyperlink:'https://example.invalid'};
    if(mode==='merge')s.mergeCells('C2:C3');
    const bytes=await serialized(w),a=await full(bytes),b=await load(bytes,when);
    assert.deepEqual(project(b),project(a),mode);
  }
});
test('drawings/comments/tables do not change source cells or require loading image bytes',async()=>{
  const w=fixture({months:2,rows:3}),s=w.getWorksheet('OCT');
  s.getCell('B2').note='PRIVATE_NOTE';
  const id=w.addImage({buffer:Buffer.from('synthetic image bytes'),extension:'png'});s.addImage(id,'L2:M4');
  s.addTable({name:'Synthetic',ref:'L7',headerRow:true,columns:[{name:'Ignored'}],rows:[[1],[2]]});
  const bytes=await serialized(w);assert.deepEqual(project(await load(bytes,when)),project(await full(bytes)));
});
test('month ambiguity, missing month, invalid year and selected worksheet limits still fail closed',async()=>{
  const ambiguous=fixture();ambiguous.addWorksheet('OCTOBER');await assert.rejects(()=>serialized(ambiguous).then(b=>load(b,when)),/Exactly one/);
  await assert.rejects(()=>serialized(fixture()).then(b=>load(b,{year:2026,month:9})),/Exactly one/);
  const old=fixture();for(let n=2;n<=old.getWorksheet('OCT').rowCount;n++)old.getWorksheet('OCT').getCell(n,8).value=new Date('2025-10-01');
  assert.throws(()=>project(old),/this year/);
  const wide=fixture();wide.getWorksheet('OCT').getCell(2,201).value='out-of-bounds';await assert.rejects(()=>serialized(wide).then(b=>load(b,when)),/limits/);
});
test('cache single-flight, expiration and failure eviction',async()=>{
  let tick=0,builds=0;const cache=createRowCache({clock:()=>tick,ttl:10});
  const build=async()=>{builds++;return new Map([['safe',[]]])};
  const pair=await Promise.all([cache.get('a',build),cache.get('a',build)]);assert.equal(builds,1);assert(pair[1].hit);
  tick=11;await cache.get('a',build);assert.equal(builds,2);
  await assert.rejects(()=>cache.get('b',async()=>{throw Error('synthetic')}));await cache.get('b',build);assert.equal(builds,3);
});
test('malformed archive and expanded-size rejection never return source XML',async()=>{
  const bytes=await serialized(fixture()),zip=await JSZip.loadAsync(bytes);
  zip.file('xl/workbook.xml','<workbook><PRIVATE_CUSTOMER>');
  await assert.rejects(()=>zip.generateAsync({type:'uint8array'}).then(b=>load(b,when)),e=>/MASTERLIST/.test(e.message)&&!e.message.includes('PRIVATE_CUSTOMER'));
  const large=await JSZip.loadAsync(bytes);large.file('xl/worksheets/sheet1.xml','x'.repeat(12*1024*1024+1));
  await assert.rejects(()=>large.generateAsync({type:'uint8array',compression:'DEFLATE'}).then(b=>load(b,when)),/expanded size/);
});
test('non-first sheet preserves shared string indices, shared formula caches, inline strings and 1904 dates',async()=>{
  for(const shared of [true,false]) {
    const w=fixture({months:2,rows:3});w.properties.date1904=true;
    w.getWorksheet('OCT').name='JAN_TMP';w.getWorksheet('JAN').name='OCT';w.getWorksheet('JAN_TMP').name='JAN';
    const s=w.getWorksheet('OCT');s.getCell('L2').value={formula:'1+1',result:2};s.getCell('L3').value={sharedFormula:'L2',result:3};
    let bytes=await w.xlsx.writeBuffer({useSharedStrings:shared});
    const zip=await JSZip.loadAsync(bytes);
    zip.file('xl/_rels/workbook.xml.rels',(await zip.file('xl/_rels/workbook.xml.rels').async('string')).replaceAll('Target="worksheets/','Target="/xl/worksheets/'));
    bytes=await zip.generateAsync({type:'uint8array'});
    const a=await full(bytes),b=await load(bytes,when);
    assert.deepEqual(project(b),project(a));
    for(const cell of ['B2','H2','L2','L3'])assert.deepEqual(b.getWorksheet('OCT').getCell(cell).value,a.getWorksheet('OCT').getCell(cell).value);
  }
});
test('worksheet expansion is rejected before ExcelJS allocates rows or merged cells',async()=>{
  const original=await serialized(fixture());
  const invalid=[
    '<sheetData><row r="20001"><c r="A20001"><v>1</v></c></row></sheetData>',
    '<sheetData><row r="1"><c r="GS1"><v>1</v></c></row></sheetData>',
    '<sheetData/><mergeCells><mergeCell ref="A1:A20001"/></mergeCells>',
    '<sheetData/><mergeCells><mergeCell ref="A1:GR501"/></mergeCells>',
    '<sheetData/><mergeCells><mergeCell ref="A1:CV501"/><mergeCell ref="CW1:GR501"/></mergeCells>',
    '<sheetData><row r="1">'+'<c r="A1"><v>1</v></c>'.repeat(100001)+'</row></sheetData>',
    '<sheetData/><mergeCells>'+'<mergeCell ref="A1:A1"/>'.repeat(1001)+'</mergeCells>',
  ];
  for(const body of invalid) {
    const zip=await JSZip.loadAsync(original);zip.file('xl/worksheets/sheet1.xml','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+body+'</worksheet>');
    const stages=[];
    await assert.rejects(()=>zip.generateAsync({type:'uint8array',compression:'DEFLATE'}).then(b=>load(b,when,async(s,fn)=>{stages.push(s);return fn()})),/limits/);
    assert(!stages.includes('xlsx_parse'),'ExcelJS must not see an oversized worksheet');
  }
  const normal=fixture();normal.getWorksheet('OCT').mergeCells('L2:M3');
  const bytes=await serialized(normal);assert.deepEqual(project(await load(bytes,when)),project(await full(bytes)));
});
test('defined names cannot expand omitted sheets, and implicit cell addresses retain ExcelJS semantics',async()=>{
  const zip=await JSZip.loadAsync(await serialized(fixture()));
  const book=await zip.file('xl/workbook.xml').async('string');
  zip.file('xl/workbook.xml',book.replace('</workbook>','<definedNames><definedName name="Unused">JAN!$A$1:$CV$500</definedName></definedNames></workbook>'));
  const xml=await zip.file('xl/worksheets/sheet1.xml').async('string');
  zip.file('xl/worksheets/sheet1.xml',xml.replace('<c r="C2"','<c'));
  const bytes=await zip.generateAsync({type:'uint8array',compression:'DEFLATE'}),selected=await load(bytes,when);
  assert.deepEqual(project(selected),project(await full(bytes)));
  assert.deepEqual(selected.definedNames.model,[]);
  zip.file('xl/worksheets/sheet1.xml','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="GR1"><v>1</v></c><c><v>2</v></c></row></sheetData></worksheet>');
  await assert.rejects(()=>zip.generateAsync({type:'uint8array'}).then(b=>load(b,when)),/limits/);
});

test('ZIP entry admission rejects oversized, ambiguous and unsupported directories before JSZip',async()=>{
  const build=async names=>{const zip=new JSZip();for(const name of names)zip.file(name,'x',{createFolders:false});return zip.generateAsync({type:'uint8array'})};
  const valid=await build(['one.xml','two.xml']);assert.equal(admitZip(valid).size,2);
  const duplicate=valid.slice();
  // Equal-length name replacement in both headers yields a real duplicate entry.
  for(let i=0;i<duplicate.length-6;i++)if(new TextDecoder().decode(duplicate.subarray(i,i+7))==='two.xml')duplicate.set(new TextEncoder().encode('one.xml'),i);
  assert.throws(()=>admitZip(duplicate),/limits/);
  assert.throws(()=>admitZip(new Uint8Array(10*1024*1024+1)),/limits/);
  for(const name of ['../one.xml','/one.xml','a/../one.xml','a\\one.xml']){const bytes=await build([name]);assert.throws(()=>admitZip(bytes),/limits/)}
  const many=await build(Array.from({length:2049},(_,i)=>'part'+i));assert.throws(()=>admitZip(many),/limits/);
  const unicode=await build(['車one.xml']);assert.equal(admitZip(unicode).size,1);
  const view=new DataView(unicode.buffer,unicode.byteOffset,unicode.byteLength);
  for(let n=0;n<unicode.length-46;n++)if(view.getUint32(n,true)===0x02014b50) {
    const extra=n+46+view.getUint16(n+28,true);
    assert.equal(view.getUint16(extra,true),0x7075);
    unicode[extra+12]='x'.charCodeAt(0); // valid UTF-8 but a different Unicode extra path
    break;
  }
  assert.throws(()=>admitZip(unicode),/limits/);
  for(const change of [b=>{b[b.length-18]=1},b=>{b[b.length-12]=255;b[b.length-11]=255},b=>{b[6]|=1},b=>{b[8]=99}]) {
    const b=valid.slice();change(b);assert.throws(()=>admitZip(b),/limits/);
  }
});

// V1 regressions: Excel writes whole-column width/style/hidden ranges up to XFD.
// The full parser accepted them; the projection must too, with identical rows.
test('column formatting ranges up to XFD are accepted with identical sale rows',async()=>{
  const cols=['<col min="38" max="16384" width="9" customWidth="1"/>','<col min="1" max="16384" width="9" style="0"/>','<col min="201" max="300" width="9" hidden="1"/>'];
  for(const col of cols) {
    const zip=await JSZip.loadAsync(await serialized(fixture({months:3,rows:31})));
    const xml=await zip.file('xl/worksheets/sheet1.xml').async('string');
    zip.file('xl/worksheets/sheet1.xml',/<cols>/.test(xml)?xml.replace('</cols>',col+'</cols>'):xml.replace('<sheetData>','<cols>'+col+'</cols><sheetData>'));
    const bytes=await zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
    assert.deepEqual(project(await load(bytes,when)),project(await full(bytes)),col);
  }
  const zip=await JSZip.loadAsync(await serialized(fixture()));
  zip.file('xl/worksheets/sheet1.xml','<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>'+'<col min="1" max="1"/>'.repeat(201)+'</cols><sheetData/></worksheet>');
  await assert.rejects(()=>zip.generateAsync({type:'uint8array'}).then(b=>load(b,when)),/limits/,'Column element count stays bounded');
});
test('formatted empty rows: real-size months pass; excessive formatting names the fix',async()=>{
  const styled=async(rows,cols)=>{
    const zip=await JSZip.loadAsync(await serialized(fixture({months:3,rows:31})));
    const letter=n=>{let s='';while(n){const m=(n-1)%26;s=String.fromCharCode(65+m)+s;n=(n-m-1)/26}return s};
    let extra='';for(let r=40;r<40+rows;r++){extra+='<row r="'+r+'">';for(let c=1;c<=cols;c++)extra+='<c r="'+letter(c)+r+'" s="0"/>';extra+='</row>'}
    const xml=await zip.file('xl/worksheets/sheet1.xml').async('string');
    zip.file('xl/worksheets/sheet1.xml',xml.replace('</sheetData>',extra+'</sheetData>'));
    return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
  };
  // MASTERLIST months measured 26k-35k cells (about 1,000 formatted rows x 37 columns).
  const typical=await styled(1000,37);assert.deepEqual(project(await load(typical,when)),project(await full(typical)));
  await assert.rejects(()=>styled(3000,40).then(b=>load(b,when)),/Clear unused formatted rows/);
});
test('worker cache serves later batches without another download and keeps the original batch size',async()=>{
  const world=fakeWorld(await serialized(fixture({months:3,rows:31})),31),rowCache=createRowCache();
  const batches=[];let result;
  do{result=await runImport({...world,loadWorkbook:load,rowCache});assert(!result.error,result.error);batches.push(result);assert(result.created.length<=3)}while(result.remaining&&batches.length<20);
  assert.equal(world.state.inventory.length,31);assert.equal(world.state.downloads,1,'One projection serves every batch on a warm worker');
  const cold=fakeWorld(await serialized(fixture({months:3,rows:31})),31);
  await runImport({...cold,loadWorkbook:load});await runImport({...cold,loadWorkbook:load});
  assert.equal(cold.state.downloads,2,'Without a cache each batch still loads the workbook');
  const changed=fakeWorld(await serialized(fixture({months:3,rows:31})),31),cache=createRowCache();
  await runImport({...changed,loadWorkbook:load,rowCache:cache});changed.state.source={...changed.state.source,md5Checksum:'c'.repeat(32)};
  await runImport({...changed,loadWorkbook:load,rowCache:cache});assert.equal(changed.state.downloads,2,'A changed MASTERLIST never reuses cached rows');
});

