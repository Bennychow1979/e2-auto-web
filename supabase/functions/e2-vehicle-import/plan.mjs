import {normalizePlate,uniquePhotos} from '../e2-drive-photos/core.mjs';
import {catalog} from './catalog.mjs';

export const MASTERLIST='1J6chzBi0limhdzc0wGtS9HX1lzxjYdS8';
export const VERSION=2;
const months=[['JAN','JANUARY'],['FEB','FEBRUARY'],['MAR','MARCH'],['APR','APRIL'],['MAY'],['JUN','JUNE'],['JUL','JULY'],['AUG','AUGUST'],['SEP','SEPT','SEPTEMBER'],['OCT','OCTOBER'],['NOV','NOVEMBER'],['DEC','DECEMBER']];
export function period(now=new Date()) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit'}).formatToParts(now);
  return {year:Number(parts.find(p=>p.type==='year').value),month:Number(parts.find(p=>p.type==='month').value)};
}
const text=value=>{
  if(value===null||value===undefined)return '';
  if(typeof value==='object') {
    // Formula caches can be stale; never silently trust one for sale data.
    if('formula' in value||'sharedFormula' in value||'error' in value)throw Error('Formula or error cell requires confirmation.');
    if(value.richText)return value.richText.map(p=>p.text).join('').trim();
    if(value instanceof Date)return value.toISOString();
    throw Error('Unsupported source cell.');
  }
  return String(value).trim();
};
const key=v=>String(v).toUpperCase().replace(/[^A-Z0-9]/g,'');
const headers={plate:'NOPLATE',brand:'BRAND',model:'MODEL',year:'YRS',engine:'CC',transmission:'AM',price:'MUDAHPRICE',date:'DATEIN'};
export function selectSheet(workbook,when) {
  const matches=workbook.worksheets.filter(s=>{
    const name=s.name.trim().toUpperCase();
    return months[when.month-1].some(m=>name===m||name===m+' '+when.year||name===when.year+' '+m);
  });
  if(matches.length!==1)throw Error('Exactly one current-month worksheet is required. No older month will be used.');
  return matches[0];
}
export function sourceRows(workbook,when,wanted) {
  const sheet=selectSheet(workbook,when),found=[];
  for(let r=1;r<=Math.min(sheet.rowCount,20);r++) {
    const columns={};
    sheet.getRow(r).eachCell((cell,c)=>{
      // Inspect header text only. Do not return or persist other workbook columns.
      let name;try{name=key(text(cell.value))}catch{return}
      for(const [field,label] of Object.entries(headers))if(name===label) {
        if(columns[field])throw Error('Duplicate '+label+' header.');
        columns[field]=c;
      }
    });
    if(Object.keys(headers).every(h=>columns[h]))found.push({r,columns});
  }
  if(found.length!==1)throw Error('Current-month headers are missing or ambiguous, including MUDAH PRICE.');
  const {r,columns}=found[0],rows=new Map();let evidence=false;
  for(let n=r+1;n<=sheet.rowCount;n++) {
    const row=sheet.getRow(n),date=row.getCell(columns.date).value;
    let year=null;
    if(date instanceof Date&&!Number.isNaN(+date))year=date.getUTCFullYear();
    else if(typeof date==='string') {
      const years=date.match(/\b(?:19|20)\d{2}\b/g);if(years?.length===1)year=Number(years[0]);
    }else if(typeof date==='number'&&date>30000&&date<100000)year=new Date(Date.UTC(1899,11,30)+date*86400000).getUTCFullYear();
    if(year!==null) {
      if(year>when.year)throw Error('Worksheet DATE IN has a future year. Confirm the source year.');
      if(year===when.year)evidence=true;
    }
    let plate;try{
      const raw=text(row.getCell(columns.plate).value);
      if(!/^[A-Za-z0-9\s-]+$/.test(raw))continue;
      plate=normalizePlate(raw);
    }catch{continue}
    if(!wanted.has(plate))continue;
    const values={plate,row:n,sheet:sheet.name};
    try{for(const field of ['brand','model','year','engine','transmission','price'])values[field]=text(row.getCell(columns[field]).value)}
    catch(error){values.error=error.message}
    rows.set(plate,[...(rows.get(plate)||[]),values]);
  }
  if(!evidence)throw Error('Cannot verify that the current-month worksheet belongs to this year.');
  return rows;
}
export function folderPlate(name) {
  const token=String(name).trim().split(/[\s_()[\]]/)[0];
  if(!/^[A-Za-z0-9-]{2,20}$/.test(token)||!/[0-9]/.test(token)||!/[A-Za-z]/.test(token))return null;
  return normalizePlate(token);
}
export function modelIdentity(brand,raw) {
  const group=Object.entries(catalog).find(([b])=>key(b)===key(brand));
  if(!group)throw Error('Brand needs manual confirmation.');
  // Longest known model prefix. Suffix stays private for review; never inferred as a spec.
  const matches=group[1].filter(m=>{
    const pattern=key(m).split('').join('[^A-Z0-9]*');
    return new RegExp('^'+pattern+'(?=$|[^A-Z0-9])','i').test(raw);
  }).sort((a,b)=>key(b).length-key(a).length);
  if(!matches.length)throw Error('Model needs manual confirmation.');
  // The original-text boundary above rejects X30 for X3, while allowing X3 2.0 or GLC250 4MATIC.
  const model=matches[0];
  return {brand:group[0],model};
}
function numeric(value,label) {
  if(!/^(?:RM\s*)?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/i.test(value))throw Error(label+' is missing or ambiguous.');
  return Number(value.replace(/^RM\s*/i,'').replaceAll(',',''));
}
export function makePlan(folder,rows,files,when) {
  const plate=folderPlate(folder.name);
  if(!plate)throw Error('Folder must begin with one exact registration number.');
  if(['W2133A','FC9555'].includes(plate))throw Error('Previously reported plate/model conflict requires manual resolution.');
  if(!rows||rows.length!==1)throw Error(rows?.length?'Duplicate plate rows in MASTERLIST.':'No exact plate match in the current month.');
  const row=rows[0];if(row.error)throw Error(row.error);
  const identity=modelIdentity(row.brand,row.model);
  const folderModel=folder.name.trim().replace(/^[^\s_()[\]]+[\s_()[\]]*/, '').trim();
  if(folderModel) {
    // A mismatching folder label cannot silently become the spreadsheet's model.
    const clean=folderModel.replace(new RegExp('^'+identity.brand.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s+','i'),'');
    let other;try{other=modelIdentity(identity.brand,clean)}catch{throw Error('Folder model label needs confirmation.')}
    if(key(other.model)!==key(identity.model))throw Error('Folder and MASTERLIST models conflict.');
  }
  const year=numeric(row.year,'Year'),engine=numeric(row.engine,'Engine capacity'),price=numeric(row.price,'MUDAH PRICE');
  if(!Number.isInteger(year)||year<1900||year>when.year+1)throw Error('Vehicle year is outside the accepted range.');
  // Masterlist CC is currently expressed in litres. Do not silently round exact CC or mixed units.
  if(engine>20||engine<0||Math.abs(engine*10-Math.round(engine*10))>1e-8)throw Error('Engine units require confirmation (expected litres).');
  if(price<=0||price>9999999||Math.abs(price*100-Math.round(price*100))>1e-6)throw Error('MUDAH PRICE is outside the accepted range.');
  const transmission={A:'Auto',AUTO:'Auto',M:'Manual',MANUAL:'Manual',CVT:'CVT',DCT:'DCT'}[row.transmission.toUpperCase()];
  if(!transmission)throw Error('Transmission requires confirmation.');
  const sorted=[...files].sort((a,b)=>a.name.localeCompare(b.name,'en',{numeric:true})||a.id.localeCompare(b.id));
  const {photos,skipped}=uniquePhotos(sorted,folder.id);
  if(!photos.length)throw Error('No supported accessible photo files.');
  if(photos.length>30)throw Error('More than 30 unique photos; select the album manually.');
  const review=['Photos have not been visually inspected. First filename is the cover; review before publishing.',
    'Fuel type PETROL and stock status Available are provisional. Confirm before publishing.',
    'Mileage is unknown. Spec is blank; verify source model wording: '+row.model];
  return {vehicle:{plate,...identity,variant:'',year,engine_litres:engine,transmission,fuel_type:'PETROL',price},
    sheet:row.sheet,row:row.row,review,skipped,
    items:photos.map(p=>({folder_id:folder.id,file_id:p.id,checksum:p.md5Checksum,mime_type:p.mimeType,size_bytes:Number(p.size)}))};
}
