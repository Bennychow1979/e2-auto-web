import {selectSheet,plateAliases} from '../e2-vehicle-import/plan.mjs';

const DAY=86400000;
export function malaysiaDate(now=new Date()) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
const literal=value=>{
  if(value==null)return '';
  if(typeof value==='object') {
    if(value.richText)return value.richText.map(v=>v.text).join('').trim();
    throw Error('A required MASTERLIST label is not a literal value.');
  }
  return String(value).trim();
};
// DATE IN is an actual calendar date. Never substitute file/page creation time,
// guess an ambiguous US date, use a formula cache, or clamp a future date to zero.
export function stockDate(value) {
  let y,m,d;
  if(value instanceof Date&&!Number.isNaN(+value)){y=value.getUTCFullYear();m=value.getUTCMonth()+1;d=value.getUTCDate()}
  else if(typeof value==='string') {
    let match=value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(match)[,y,m,d]=match.map(Number);
    else {match=value.trim().match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);if(!match)return null;[,d,m,y]=match.map(Number)}
  }else return null;
  const n=Date.UTC(y,m-1,d),date=new Date(n);
  return y>=1900&&y<=2100&&date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d?date.toISOString().slice(0,10):null;
}
export function fleetSummary(workbook,now=new Date()) {
  const today=malaysiaDate(now),month=today.slice(0,7),sheet=selectSheet(workbook,{year:Number(month.slice(0,4)),month:Number(month.slice(5))});
  const found=[];
  for(let n=1;n<=Math.min(sheet.rowCount,20);n++) {
    const columns={};sheet.getRow(n).eachCell((cell,c)=>{
      let t;try{t=literal(cell.value).toUpperCase().replace(/[^A-Z0-9]/g,'')}catch{return}
      if(['NOPLATE','DATEIN','BRAND','MODEL'].includes(t)){if(columns[t])throw Error('Duplicate MASTERLIST header.');columns[t]=c}
    });
    if(['NOPLATE','DATEIN','BRAND','MODEL'].every(k=>columns[k]))found.push({row:n,...columns});
  }
  if(found.length!==1)throw Error('MASTERLIST headers need review.');
  const cols=found[0],rows=[],markers=new Set();let section='stock',yearEvidence=false;
  for(let n=cols.row+1;n<=sheet.rowCount;n++) {
    const row=sheet.getRow(n);let p=literal(row.getCell(cols.NOPLATE).value).toUpperCase();
    if(!p){
      if(section!=='plates'&&(row.getCell(cols.BRAND).value||row.getCell(cols.MODEL).value))throw Error('A MASTERLIST vehicle registration is missing.');
      continue;
    }
    if(['EK RAWANG','BTC BRANCH','XSTAR REPO'].includes(p))continue;
    const next={'PLATE FOR SALES':'plates','PENDING DELIVERY / DONE SIGN LOAN':'pending','SOLD & DELIVERED':'delivered'}[p];
    if(next){
      if(markers.has(next))throw Error('Repeated MASTERLIST section.');
      if(next==='plates'&&section!=='stock'||next==='pending'&&!['stock','plates'].includes(section)||next==='delivered'&&section!=='pending')throw Error('Unexpected MASTERLIST section order.');
      markers.add(next);section=next;continue;
    }
    // The workbook appends an older month's closing calculation below deliveries.
    // It is not part of the current month's fleet, even when plates repeat there.
    if(/\bSALES CLOSING$/.test(p)){if(section!=='delivered')throw Error('Unexpected MASTERLIST section order.');break}
    if(section==='plates')continue;
    const aliases=plateAliases(p);
    if(!aliases.length){if(p==='TOTAL'||p==='NO PLATE'||p==='NOPLATE')continue;throw Error('Unrecognised MASTERLIST section or registration.');}
    if(!literal(row.getCell(cols.BRAND).value)||!literal(row.getCell(cols.MODEL).value))throw Error('MASTERLIST vehicle identity needs review.');
    const date=stockDate(row.getCell(cols.DATEIN).value);
    if(date?.startsWith(month.slice(0,4)))yearEvidence=true;
    rows.push({aliases,section,date});
  }
  if(!markers.has('delivered')||!markers.has('pending')||!yearEvidence)throw Error('The current-month MASTERLIST cannot be verified.');
  const seen=new Set();
  for(const row of rows)for(const alias of row.aliases){if(seen.has(alias))throw Error('Duplicate registration across MASTERLIST fleet sections.');seen.add(alias)}
  const stock=rows.filter(r=>r.section==='stock'),ages=[0,0,0,0];let missingDates=0;
  for(const row of stock) {
    if(!row.date||row.date>today){missingDates++;continue}
    const days=(Date.parse(today)-Date.parse(row.date))/DAY;
    ages[days<=30?0:days<=60?1:days<=90?2:3]++;
  }
  return {month,today,sheet:sheet.name,stock:stock.length,pending:rows.filter(r=>r.section==='pending').length,delivered:rows.filter(r=>r.section==='delivered').length,ages,missingDates};
}
