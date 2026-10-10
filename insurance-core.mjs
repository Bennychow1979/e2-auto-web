// Deterministic local suggestions, not an insurer decision or a correctness score.
export const PARSER_VERSION='local-policy-text-v1';
export const FIELDS=[
  ['insurer','Insurer','text'],['policy_number','Policy number','text'],
  ['registration','Vehicle registration','text'],['insured_name','Insured name','text'],
  ['sum_insured','Sum insured (RM)','money'],['premium','Premium (RM)','money'],
  ['ncd','NCD (%)','percent'],['inception','Inception date','date'],['expiry','Expiry date','date'],
];
const aliases={insurer:'insurer|insurance company|syarikat insurans',policy_number:'policy (?:number|no[.]?)|no[.]? polisi|nombor polisi',registration:'vehicle registration(?: (?:number|no[.]?))?|registration (?:number|no[.]?)|no[.]? pendaftaran',insured_name:'insured name|name of insured|nama (?:pemegang polisi|diinsuranskan)',sum_insured:'sum insured|jumlah diinsuranskan',premium:'(?:total |gross )?premium(?: payable)?|jumlah premium',ncd:'ncd|no claim discount',inception:'inception date|effective date|tarikh mula',expiry:'expiry date|expiration date|tarikh tamat'};
const months=['january','february','march','april','may','june','july','august','september','october','november','december'];
export const registrationKey=value=>String(value||'').toUpperCase().replace(/[\s-]/g,'');
function validDate(y,m,d){
  const date=new Date(Date.UTC(y,m-1,d));
  return y>=1900&&y<=2100&&date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d ? `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}` : null;
}
export function policyDate(value){
  const s=String(value).trim();let m;
  if((m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/)))return validDate(+m[1],+m[2],+m[3]);
  if((m=s.match(/^(\d{1,2})[ /-]([A-Za-z]{3,9})[ /-](\d{4})$/))){const month=months.findIndex(name=>m[2].toLowerCase()===name||m[2].toLowerCase()===name.slice(0,3));return month>=0?validDate(+m[3],month+1,+m[1]):null;}
  if((m=s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/))){
    // Never assume DD/MM for an ambiguous document, even on a Malaysian device.
    if(+m[1]>12&&+m[2]<=12)return validDate(+m[3],+m[2],+m[1]);
    if(+m[2]>12&&+m[1]<=12)return validDate(+m[3],+m[1],+m[2]);
  }
  return null;
}
export function reviewedValue(key,value){
  const field=FIELDS.find(f=>f[0]===key),s=String(value??'').trim();
  if(!field||!s||s.length>160||/[\u0000-\u001f\u007f]/.test(s))throw Error('Enter a non-empty, valid '+(field?.[1]||'policy field')+'.');
  if(field[2]==='date'){const date=/^\d{4}-\d{2}-\d{2}$/.test(s)&&policyDate(s);if(!date)throw Error('Use a valid YYYY-MM-DD date.');return date;}
  if(['money','percent'].includes(field[2])){
    if(!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(s)||+s>(field[2]==='percent'?100:100000000))throw Error('Use a non-negative number with at most two decimals for '+field[1]+'.');
    return field[2]==='money'?Number(s).toFixed(2):String(Number(s));
  }
  if(key==='registration'){
    if(!/^[A-Za-z0-9][A-Za-z0-9 -]{0,29}$/.test(s))throw Error('Enter a valid vehicle registration.');
    return registrationKey(s);
  }
  return s;
}
function candidateValue(key,raw){
  const kind=FIELDS.find(f=>f[0]===key)[2];let value=raw;
  if(kind==='date')value=policyDate(raw);
  if(kind==='money'){
    const m=raw.match(/^(?:RM|MYR)\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)$/i);
    value=m?m[1].replaceAll(',',''):null;
  }
  if(kind==='percent'){const m=raw.match(/^(\d+(?:\.\d{1,2})?)\s*%$/);value=m?m[1]:null;}
  try{return value==null?null:reviewedValue(key,value);}catch{return null;}
}
export function extractPolicyText(pages,mode='text_pdf'){
  const fields=Object.fromEntries(FIELDS.map(([key])=>[key,{value:null,issue:'Not found. Enter only after checking the original.',page:null,excerpt:''}]));
  for(const [key] of FIELDS){
    const candidates=[];const pattern=new RegExp('^(?:'+aliases[key]+')\\s*[:：]\\s*(.{1,220})$','i');
    for(const page of pages)for(const line of page.lines){const m=line.trim().match(pattern);if(m)candidates.push({value:candidateValue(key,m[1].trim()),page:page.page,excerpt:line.trim().slice(0,240)});}
    if(!candidates.length)continue;
    const values=new Set(candidates.map(c=>c.value));
    if(values.size!==1||values.has(null)){fields[key]={value:null,issue:'Ambiguous or unsupported value. Check the original and enter it manually.',page:candidates[0].page,excerpt:candidates[0].excerpt};continue;}
    fields[key]={...candidates[0],issue:'Unverified suggestion. Check against the original.'};
  }
  if(fields.inception.value&&fields.expiry.value&&fields.expiry.value<fields.inception.value){
    for(const key of ['inception','expiry'])fields[key]={...fields[key],value:null,issue:'Date order conflicts. Check both dates manually.'};
  }
  return {version:PARSER_VERSION,mode,fields};
}
export function policyPatch(values,selected,current={},replace=[]){
  const patch={};
  for(const key of selected){patch[key]=reviewedValue(key,values[key]);if(current[key]!=null&&current[key]!==patch[key]&&!replace.includes(key))throw Error('Confirm replacement of the existing '+FIELDS.find(f=>f[0]===key)[1]+'.');}
  if(!Object.keys(patch).length)throw Error('Select at least one checked field to save.');
  const merged={...current,...patch};
  if(merged.inception&&merged.expiry&&merged.expiry<merged.inception)throw Error('Expiry cannot precede inception.');
  return patch;
}
