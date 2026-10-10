// Deterministic local suggestions, not an insurer decision or a correctness score.
export const PARSER_VERSION='local-policy-text-v2';
export const FIELDS=[
  ['insurer','Insurer','text'],['policy_number','Policy number','text'],
  ['registration','Vehicle registration','text'],['insured_name','Insured name','text'],
  ['sum_insured','Sum insured (RM)','money'],['premium','Premium (RM)','money'],
  ['ncd','NCD (%)','percent'],['inception','Inception date','date'],['expiry','Expiry date','date'],
];
const aliases={insurer:'insurer|insurance company|takaful operator|syarikat insurans',policy_number:'(?:policy|certificate) (?:number|no[.]?)|no[.]? polisi|nombor polisi',registration:'vehicle registration(?: (?:number|no[.]?))?|registration (?:number|no[.]?)|no[.]? pendaftaran',insured_name:'insured name|name of insured|participant name|name of participant|nama (?:pemegang polisi|diinsuranskan)',sum_insured:'sum (?:insured|covered)|jumlah diinsuranskan',premium:'(?:total )?premium(?: payable)?|total contribution(?: payable)?|jumlah premium',ncd:'ncd|no claim discount',inception:'inception date(?:(?:/| and )time)?|effective date|tarikh mula',expiry:'expiry date(?:(?:/| and )time)?|expiration date|tarikh tamat'};
aliases.chassis='chassis (?:number|no[.]?)|vin|vehicle identification number';
aliases.premium+='|rounded(?: total)? (?:premium|contribution|payable)|(?:total |final )?amount payable|total payable';
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
  if(!field||!s||s.length>160||/^(?:n\/?a|not applicable|not available|[.\-–—]+)$/i.test(s)||/[\u0000-\u001f\u007f]/.test(s))throw Error('Enter a non-empty, valid '+(field?.[1]||'policy field')+'.');
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
  if(key==='chassis')return /^[A-Za-z0-9 -]{5,40}$/.test(raw)&&/^[A-Z0-9]{5,40}$/.test(registrationKey(raw))?registrationKey(raw):null;
  const kind=FIELDS.find(f=>f[0]===key)[2];let value=raw;
  if(kind==='date')value=policyDate(raw);
  if(kind==='money'){
    const m=raw.match(/^(?:RM|MYR)\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)$/i);
    value=m?m[1].replaceAll(',',''):null;
  }
  if(kind==='percent'){const m=raw.match(/^(\d+(?:\.\d{1,2})?)\s*%$/);value=m?m[1]:null;}
  try{return value==null?null:reviewedValue(key,value);}catch{return null;}
}
function datedValue(raw){
  const m=raw.match(/^(.*?)[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if(!m)return {value:policyDate(raw),time:null};
  let hour=+m[2];const minute=+m[3],second=+(m[4]||0),meridiem=m[5]?.toUpperCase();
  if(minute>59||second>59||(meridiem?(hour<1||hour>12):hour>23))return {value:null,time:null};
  if(meridiem)hour=hour%12+(meridiem==='PM'?12:0);
  return {value:policyDate(m[1]),time:[hour,minute,second].map(n=>String(n).padStart(2,'0')).join(':')};
}
function pageKind(page){
  // Only explicit standalone headings identify a source. Unknown continuation
  // pages are never silently absorbed into a schedule in a mixed bundle.
  const headings=page.lines.map(s=>s.trim()).filter(Boolean).slice(0,8),found=[];
  for(const line of headings){
    const schedule=line.match(/^(?:(?:motor )?(?:takaful|insurance|policy) schedule)(?:\s*(?:-|\()?\s*(continued|page (\d+) of (\d+))\)?)?$/i);
    if(schedule)found.push({kind:'schedule',heading:line,continued:!!schedule[1]&&!schedule[2],position:schedule[2]?+schedule[2]:null,total:schedule[3]?+schedule[3]:null});
    else{
      const certificate=line.match(/^(?:motor )?(?:takaful|insurance) (?:certificate|policy)(?:\s*(?:-|\()?\s*(continued|page (\d+) of (\d+))\)?)?$/i);
      if(certificate)found.push({kind:'certificate',heading:line,continued:!!certificate[1]&&!certificate[2],position:certificate[2]?+certificate[2]:null,total:certificate[3]?+certificate[3]:null});
      else if(/^(?:(?:vehicle|loan) )?instalment note$|^road[ -]tax receipt$|^(?:vehicle )?ownership certificate$|^internal costing(?: sheet)?$|^privacy notice(?:\s*-\s*continued)?$/i.test(line))found.push({kind:'other',heading:line});
    }
  }
  return {...page,...(found.length>1?{kind:'unclear',heading:found.map(f=>f.heading).join(' / ')}:found[0]||{kind:'unknown',heading:''})};
}
function checkPackets(pages,kind){
  let groups=0,previous=null;
  const incomplete=()=>previous?.position!=null&&previous.position!==previous.total?{blocked:'Incomplete '+kind+' packet detected from page numbers. Obtain the complete correct original before saving.',evidence:previous}:null;
  for(const page of pages){
    if(page.kind!==kind){const issue=incomplete();if(issue)return issue;previous=null;continue;}
    if(page.position!=null&&(page.position<1||page.total<page.position||page.total>20))return {blocked:'Unclear '+kind+' pagination. Review the original manually.',evidence:page};
    const continuation=previous&&(page.continued||page.position>1&&previous.position===page.position-1&&previous.total===page.total);
    if((page.continued||page.position>1)&&!continuation)return {blocked:'Unclear '+kind+' continuation. Review the original manually.',evidence:page};
    if(!continuation){const issue=incomplete();if(issue)return issue;groups++;}
    previous=page;
  }
  return incomplete()||{groups};
}
function policySources(pages){
  const classified=pages.map(pageKind),schedules=classified.filter(p=>p.kind==='schedule');
  const unclear=classified.find(p=>p.kind==='unclear');
  if(unclear)return {blocked:'Conflicting document headings. Review the correct policy manually.',evidence:unclear};
  const schedulePacket=checkPackets(classified,'schedule'),certificatePacket=checkPackets(classified,'certificate');
  if(schedulePacket.blocked)return schedulePacket;if(certificatePacket.blocked)return certificatePacket;
  if(schedules.length){
    if(schedulePacket.groups!==1)return {blocked:'Multiple schedules detected. Select the correct policy and enter checked fields manually.',evidence:schedules[0]};
    return {primary:schedules,support:classified.filter(p=>p.kind==='certificate'),schedule:true};
  }
  const certificates=classified.filter(p=>p.kind==='certificate');
  if(certificates.length)return {primary:certificates,support:[],schedule:false};
  const excluded=classified.find(p=>p.kind==='other');
  if(excluded)return {blocked:'No identifiable policy schedule or certificate in this mixed bundle. Review manually.',evidence:excluded};
  return {primary:classified,support:[],schedule:false};
}
function fieldCandidates(pages,key){
  const pattern=new RegExp('^('+aliases[key]+')\\s*[:：]\\s*(.{1,220})$','i'),candidates=[];
  for(const page of pages)for(const line of page.lines){
    const match=line.trim().match(pattern);if(!match)continue;
    const raw=match[2].trim();if(/^(?:n\/?a|not applicable|not available|[.\-–—]+)$/i.test(raw))continue;
    const date=['inception','expiry'].includes(key)?datedValue(raw):null;
    candidates.push({value:date?date.value:candidateValue(key,raw),time:date?.time||null,page:page.page,excerpt:line.trim().slice(0,240),final:key==='premium'&&/^(?:total |rounded|(?:final )?amount payable)/i.test(match[1])});
  }
  // A final total includes the contribution and applicable charges. Subtotals
  // (including basic/gross contribution) are not final-premium candidates.
  return key==='premium'&&candidates.some(c=>c.final)?candidates.filter(c=>c.final):candidates;
}
function conflicts(candidates){
  return candidates.some(c=>c.value==null)||new Set(candidates.map(c=>c.value)).size>1||new Set(candidates.map(c=>c.time).filter(Boolean)).size>1;
}
const conflictExcerpt=candidates=>[...new Set(candidates.map(c=>'p'+c.page+' '+c.excerpt))].slice(0,3).join(' | ').slice(0,240);
export function extractPolicyText(pages,mode='text_pdf'){
  const fields=Object.fromEntries(FIELDS.map(([key])=>[key,{value:null,issue:'Not found. Enter only after checking the original.',page:null,excerpt:''}]));
  const identity={chassis:{value:null,issue:'No chassis text found. Verify against the original vehicle record.',page:null,excerpt:''}};
  if(mode!=='text_pdf')return {version:PARSER_VERSION,mode,fields,identity};
  const sources=policySources(pages);
  if(!sources.blocked){
    const identifiers=fieldCandidates([...sources.primary,...sources.support],'policy_number');
    if(identifiers.length&&conflicts(identifiers)){sources.blocked='Conflicting policy or certificate identifiers. Review the correct policy manually.';sources.evidence=identifiers[0];}
  }
  if(sources.blocked){
    for(const key of Object.keys(fields))fields[key]={value:null,issue:sources.blocked,page:sources.evidence.page,excerpt:(sources.evidence.heading||sources.evidence.excerpt||'').slice(0,240)};
    identity.chassis={...fields.registration};
    return {version:PARSER_VERSION,mode,fields,identity};
  }
  for(const key of [...FIELDS.map(([key])=>key),'chassis']){
    const candidates=fieldCandidates(sources.primary,key);
    if(!candidates.length)continue;
    const first=candidates[0],support=fieldCandidates(sources.support,key);
    const destination=key==='chassis'?identity:fields;
    if(conflicts(candidates)){destination[key]={value:null,issue:'Ambiguous or unsupported value. Check the original and enter it manually.',page:first.page,excerpt:conflictExcerpt(candidates)};continue;}
    if(support.length&&conflicts([...candidates,...support])){destination[key]={value:null,issue:'Schedule and certificate evidence conflict. Check both originals and enter manually.',page:first.page,excerpt:conflictExcerpt([...candidates,...support])};continue;}
    destination[key]={value:first.value,page:first.page,excerpt:first.excerpt,issue:'Unverified suggestion. Check against the original.'+(sources.schedule?' Schedule source.':'')+(candidates.some(c=>c.time)?' Date only; verify the time shown in the source.':'')};
  }
  if(fields.inception.value&&fields.expiry.value&&fields.expiry.value<fields.inception.value){
    for(const key of ['inception','expiry'])fields[key]={...fields[key],value:null,issue:'Date order conflicts. Check both dates manually.'};
  }
  return {version:PARSER_VERSION,mode,fields,identity};
}
export function policyIdentityReview(extraction,source={}){
  const plate=extraction.fields.registration,chassis=extraction.identity?.chassis;
  const expectedPlate=registrationKey(source.plate),expectedChassis=registrationKey(source.chassis||source.vin);
  const messages=[];let blocked=false;
  for(const [title,evidence,expected] of [['Vehicle registration',plate,expectedPlate],['Chassis number',chassis,expectedChassis]]){
    if(evidence?.page!=null&&evidence.value==null){blocked=true;messages.push(title+' evidence is ambiguous. '+evidence.issue+' Resolve the correct original and case before saving.');}
    else if(evidence?.value&&expected&&registrationKey(evidence.value)!==expected){blocked=true;messages.push(title+' '+evidence.value+' differs from this case ('+expected+'). Choose the matching vehicle transaction and original.');}
    else if(!expected||!evidence?.value)messages.push(title+' is not verified by the system. Check it manually against this vehicle transaction before confirming.');
    else messages.push(title+' text matches this case; still check the original.');
  }
  if(source.chassis&&source.vin&&registrationKey(source.chassis)!==registrationKey(source.vin)){blocked=true;messages.push('Case chassis identifiers conflict. Resolve the case record before saving.');}
  return {blocked,messages};
}
export function policyPatch(values,selected,current={},replace=[]){
  const patch={};
  for(const key of selected){patch[key]=reviewedValue(key,values[key]);if(current[key]!=null&&current[key]!==patch[key]&&!replace.includes(key))throw Error('Confirm replacement of the existing '+FIELDS.find(f=>f[0]===key)[1]+'.');}
  if(!Object.keys(patch).length)throw Error('Select at least one checked field to save.');
  const merged={...current,...patch};
  if(merged.inception&&merged.expiry&&merged.expiry<merged.inception)throw Error('Expiry cannot precede inception.');
  return patch;
}
