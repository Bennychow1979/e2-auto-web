// Review, then update, the public number-plate list from a local MASTERLIST copy.
// Preview is the default. --write refuses to change anything while issues remain.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import ExcelJS from 'exceljs';
import {period} from '../supabase/functions/e2-vehicle-import/plan.mjs';
import {extractPlateSales,diffPlates,formatPrice,renderPlatesPage} from './plate-sales-core.mjs';

const root=new URL('../',import.meta.url),defaultData=new URL('data/plates-for-sale.json',root),defaultPage=new URL('plates.html',root);

export async function run(args,log=console.log,{dataFile=defaultData,pageFile=defaultPage}={}) {
  const file=args.find(a=>!a.startsWith('--')),write=args.includes('--write'),monthArg=args.find(a=>a.startsWith('--month='));
  if(!file)throw Error('Usage: node scripts/plate-sales.mjs <MASTERLIST.xlsx> [--month=YYYY-MM] [--write]');
  const when=monthArg?(([y,m])=>({year:+y,month:+m}))(monthArg.slice(8).split('-')):period();
  const bytes=await readFile(file),workbook=new ExcelJS.Workbook();await workbook.xlsx.load(bytes);
  const result=extractPlateSales(workbook,when);
  let current={plates:[]};try{current=JSON.parse(await readFile(dataFile,'utf8'))}catch(error){if(error.code!=='ENOENT')throw error}
  log('Sheet '+result.sheet+(result.marker?' · block '+result.marker+' (rows '+result.firstRow+'–'+result.lastRow+')':''));
  for(const p of result.plates)log('  '+p.plate.padEnd(12)+formatPrice(p.price));
  for(const i of result.issues)log('  CHECK'+(i.row?' row '+i.row:'')+(i.plate?' '+i.plate:'')+': '+i.issue);
  for(const n of result.notes)log('  NOTE row '+n.row+' '+n.plate+': '+n.note);
  const diff=diffPlates(current.plates,result.plates);
  log('Changes vs published list: +'+diff.added.length+' added, '+diff.removed.length+' removed, '+diff.repriced.length+' repriced');
  for(const p of diff.added)log('  + '+p.plate+' '+formatPrice(p.price));
  for(const p of diff.removed)log('  - '+p.plate+' '+formatPrice(p.price));
  for(const p of diff.repriced)log('  ~ '+p.plate+' '+formatPrice(p.from)+' → '+formatPrice(p.to));
  if(!write){log('Preview only. Nothing was written.');return {result,diff,written:false}}
  if(result.issues.length){log('Not written: resolve every CHECK item in MASTERLIST first. The published list is unchanged.');return {result,diff,written:false}}
  const data={version:1,checked_at:new Date().toISOString(),source:{sheet:result.sheet,block:result.marker,sha256:createHash('sha256').update(bytes).digest('hex')},plates:result.plates};
  await writeFile(pageFile,renderPlatesPage(await readFile(pageFile,'utf8'),result.plates));
  await writeFile(dataFile,JSON.stringify(data,null,2)+'\n');
  log('Written: plates.html and data/plates-for-sale.json. Review the preview before release.');
  return {result,diff,written:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await run(process.argv.slice(2));
