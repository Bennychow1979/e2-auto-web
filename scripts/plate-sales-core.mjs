// Number plates for sale: read the MASTERLIST "PLATE FOR SALES" block and render
// the public list. Only the plate number and asking price ever leave the sheet.
import {selectSheet,plateAliases} from '../supabase/functions/e2-vehicle-import/plan.mjs';
import {escapeHTML} from '../i18n.mjs';

export const MARKER=/^PLATE\s*(?:NO\.?\s*)?FOR\s*SALES?$/i;
export const WHATSAPP='60122785126';
export const ENQUIRY='Hi E2 Auto, I am interested in number plate {plate} ({price}).';
const MAX_ROWS=200,MAX_PRICE=1000000;
const key=v=>String(v).toUpperCase().replace(/[^A-Z0-9]/g,'');
function cellText(value) {
  if(value===null||value===undefined)return '';
  if(typeof value==='object') {
    if('formula' in value||'sharedFormula' in value||'error' in value)throw Error('Formula or error cell requires confirmation.');
    if(value.richText)return value.richText.map(p=>p.text).join('').trim();
    throw Error('Unsupported cell.');
  }
  return String(value).trim();
}
export const formatPrice=price=>'RM'+Number(price).toLocaleString('en-MY');
export const normalizePlate=raw=>String(raw).toUpperCase().replace(/\s+/g,' ').trim();

// Header columns are found by their labels; rows move every month, so no row
// or column number is assumed. Issues block publishing; notes are informational.
export function extractPlateSales(workbook,when) {
  const sheet=selectSheet(workbook,when),issues=[],notes=[],plates=[];
  let plateColumn,priceColumn,headerRow;
  for(let r=1;r<=Math.min(sheet.rowCount,20)&&!headerRow;r++) {
    const found={};
    sheet.getRow(r).eachCell((cell,c)=>{let name;try{name=key(cellText(cell.value))}catch{return}if(name==='NOPLATE')found.plate=c;if(name==='MUDAHPRICE')found.price=c});
    if(found.plate&&found.price){headerRow=r;plateColumn=found.plate;priceColumn=found.price}
  }
  if(!headerRow)return {sheet:sheet.name,plates,issues:[{issue:'No Plate / MUDAH PRICE headers were not found in the current-month sheet.'}],notes};
  const markers=[];
  for(let r=headerRow+1;r<=sheet.rowCount;r++)sheet.getRow(r).eachCell((cell,c)=>{let t;try{t=cellText(cell.value)}catch{return}if(MARKER.test(t))markers.push({row:r,column:c,cell:cell.address})});
  const base={sheet:sheet.name,headerRow,plateColumn,priceColumn};
  if(markers.length!==1)return {...base,plates,issues:[{issue:markers.length?'More than one PLATE FOR SALES block ('+markers.map(m=>m.cell).join(', ')+').':'PLATE FOR SALES block was not found in the current-month sheet.'}],notes};
  const marker=markers[0];
  if(marker.column!==plateColumn)issues.push({row:marker.row,issue:'PLATE FOR SALES is not in the No Plate column; confirm the block layout.'});
  const rows=[];let r=marker.row+1;
  for(;r<=sheet.rowCount;r++) {
    const row=sheet.getRow(r);let raw;
    try{raw=cellText(row.getCell(plateColumn).value)}catch(error){issues.push({row:r,issue:'Number: '+error.message});continue}
    if(!raw)break;
    if(rows.length>=MAX_ROWS){issues.push({row:r,issue:'More than '+MAX_ROWS+' rows; confirm where the block ends.'});break}
    const plate=normalizePlate(raw);
    if(!/^[A-Z0-9 ]{2,12}$/.test(plate)||!/[A-Z]/.test(plate)||!/\d/.test(plate)){issues.push({row:r,plate,issue:'Number format needs confirmation.'});continue}
    let price=row.getCell(priceColumn).value;
    try {
      if(typeof price!=='number') {
        const text=cellText(price);
        if(!/^(?:RM\s*)?\d{1,3}(?:,\d{3})*(?:\.\d+)?$|^(?:RM\s*)?\d+(?:\.\d+)?$/i.test(text))throw Error('Price is missing or not a number.');
        price=Number(text.replace(/^RM\s*/i,'').replaceAll(',',''));
      }
      if(!Number.isFinite(price)||price<=0||!Number.isInteger(price)||price>MAX_PRICE)throw Error('Price is outside the accepted range (whole ringgit, RM1–'+formatPrice(MAX_PRICE).slice(2)+').');
    }catch(error){issues.push({row:r,plate,issue:error.message});continue}
    rows.push({row:r,plate,price});
  }
  // Duplicates are never resolved automatically: every copy is held back.
  const counts=new Map();for(const item of rows)counts.set(key(item.plate),(counts.get(key(item.plate))||0)+1);
  for(const item of rows) {
    if(counts.get(key(item.plate))>1)issues.push({row:item.row,plate:item.plate,issue:'Duplicate number in the PLATE FOR SALES block.'});
    else plates.push({plate:item.plate,price:item.price});
  }
  // A listed number may also sit on a stock vehicle; report it, do not guess.
  const listed=new Set(rows.map(item=>key(item.plate)));
  for(let n=headerRow+1;n<=sheet.rowCount;n++) {
    if(n>marker.row&&n<r)continue;
    let aliases;try{aliases=plateAliases(cellText(sheet.getRow(n).getCell(plateColumn).value))}catch{continue}
    for(const alias of aliases)if(listed.has(alias))notes.push({row:n,plate:alias,note:'This number also appears outside the PLATE FOR SALES block.'});
  }
  return {...base,marker:marker.cell,firstRow:marker.row+1,lastRow:r-1,plates,issues,notes};
}

export function diffPlates(before=[],after=[]) {
  const old=new Map(before.map(p=>[key(p.plate),p])),now=new Map(after.map(p=>[key(p.plate),p]));
  return {
    added:after.filter(p=>!old.has(key(p.plate))),
    removed:before.filter(p=>!now.has(key(p.plate))),
    repriced:after.filter(p=>old.has(key(p.plate))&&old.get(key(p.plate)).price!==p.price).map(p=>({plate:p.plate,from:old.get(key(p.plate)).price,to:p.price}))
  };
}

export const enquiryURL=(text)=>'https://wa.me/'+WHATSAPP+'?text='+encodeURIComponent(text);
export function plateItem(plate,price) {
  const label=formatPrice(price);
  return '<li class="plateCard"><p class="plateNumber" lang="en">'+escapeHTML(plate)+'</p>'+
    '<p class="platePrice"><span class="small">Asking price</span><strong>'+escapeHTML(label)+'</strong></p>'+
    '<a class="primary plateEnquiry" data-plate="'+escapeHTML(plate)+'" data-price="'+escapeHTML(label)+'" href="'+escapeHTML(enquiryURL(ENQUIRY.replace('{plate}',plate).replace('{price}',label)))+'" target="_blank" rel="noopener noreferrer">Enquire on WhatsApp ↗</a></li>';
}
export function structuredData(plates) {
  return JSON.stringify({'@context':'https://schema.org','@type':'ItemList',name:'Number plates for sale at E2 Auto',
    itemListElement:plates.map((p,i)=>({'@type':'ListItem',position:i+1,item:{'@type':'Product',name:'Number plate '+p.plate,
      offers:{'@type':'Offer',price:String(p.price),priceCurrency:'MYR',url:'https://e2auto.my/plates.html',seller:{'@type':'AutoDealer',name:'E2 Auto'}}}}))}).replace(/</g,'\\u003c');
}
// Replace only the generated regions of plates.html.
export function renderPlatesPage(template,plates) {
  const list=plates.length?plates.map(p=>plateItem(p.plate,p.price)).join('\n'):'<li class="plateEmpty">No number plates are listed right now.</li>';
  const start='<!-- plate-sales:start -->',end='<!-- plate-sales:end -->';
  if(template.split(start).length!==2||template.split(end).length!==2)throw Error('plates.html must contain exactly one generated plate list region.');
  let html=template.replace(new RegExp(start+'[\\s\\S]*?'+end),()=>start+'\n'+list+'\n'+end);
  if(!/<script id="plateStructuredData" type="application\/ld\+json">[^<]*<\/script>/.test(html))throw Error('plates.html must contain the plate structured data script.');
  return html.replace(/<script id="plateStructuredData" type="application\/ld\+json">[^<]*<\/script>/,()=>'<script id="plateStructuredData" type="application/ld+json">'+structuredData(plates)+'</script>');
}
