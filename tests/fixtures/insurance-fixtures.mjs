import {extractPolicyText} from '../../insurance-core.mjs';
import {deflateSync} from 'node:zlib';
// A complete synthetic PNG with valid chunk CRCs, decoded by the real browser.
export function policyPNG(){
  const crc=buffer=>{let n=0xffffffff;for(const b of buffer){n^=b;for(let bit=0;bit<8;bit++)n=(n>>>1)^((n&1)?0xedb88320:0);}return (n^0xffffffff)>>>0;};
  const chunk=(type,data)=>{const name=Buffer.from(type),size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([name,data])));return Buffer.concat([size,name,data,sum]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(2,0);header.writeUInt32BE(2,4);header[8]=8;header[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([0,255,255,255,255,255,255,0,255,255,255,255,255,255]))),chunk('IEND',Buffer.alloc(0))]);
}
export const policyLines=['Insurer: Synthetic Assurance Berhad','Policy Number: TEST-POLICY-001','Vehicle Registration: SYNTH123','Insured Name: Fictional Customer','Sum Insured: RM 50,000.00','Total Premium: RM 1,250.50','NCD: 55%','Inception Date: 2026-10-13','Expiry Date: 2027-10-12'];
export const caseId='44444444-4444-4444-8444-444444444444',sourceId='11111111-1111-4111-8111-111111111111',userId='55555555-5555-4555-8555-555555555555';
export function policyPDF(lines=policyLines,pageCount=1){
  return policyPagesPDF(Array.from({length:pageCount},()=>({lines})));
}
export function policyPagesPDF(pages){
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids=[];
  for(const {lines=[],raster=false} of pages){
    const id=objects.length+1;kids.push(id+' 0 R');
    const stream=raster?'q 420 0 0 600 70 90 cm /Im1 Do Q\n':'BT /F1 12 Tf 40 760 Td '+lines.map((line,n)=>(n?'0 -24 Td ':'')+'('+line.replace(/[\\()]/g,'\\$&')+') Tj').join('\n')+' ET\n';
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> ${raster?`/XObject << /Im1 ${id+2} 0 R >>`:''} >> /Contents ${id+1} 0 R >>`,`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`);
    if(raster){
      // Invented form-shaped pixels only: no real scan, text layer or identity.
      const pixels=Array.from({length:32*48},(_,n)=>{const x=n%32,y=Math.floor(n/32);return x>2&&x<29&&(y===4||y>10&&y%5===0)?'88':'ff';}).join('')+'>\n';
      objects.push(`<< /Type /XObject /Subtype /Image /Width 32 /Height 48 /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${Buffer.byteLength(pixels)} >>\nstream\n${pixels}endstream`);
    }
  }
  objects[1]=`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`;
  let pdf='%PDF-1.4\n';const offsets=[0];objects.forEach((object,n)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${n+1} 0 obj\n${object}\nendobj\n`;});const xref=Buffer.byteLength(pdf);
  pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
// Wholly invented mixed delivery bundle. Only its document categories and label
// distinctions model the requested layout; every identifier/value is fictional.
export const takafulExpected={insurer:'Fictional Cedar Takaful',policy_number:'SYN-CERT-2040-A',registration:'SYNTH123',insured_name:'Imaginary Rowan Example',sum_insured:'64000.00',premium:'1116.80',ncd:'45',inception:'2040-11-18',expiry:'2041-11-17'};
export function mixedPolicyPages(){return [
  {page:1,lines:['Vehicle Instalment Note','Borrower: Fictional Borrower Example','Loan Instalment Date: 2040-12-28','Expiry Date: 2045-12-28','Monthly Instalment: RM 825.00','Receipt Number:']},
  {page:2,lines:[],raster:true},{page:3,lines:[],raster:true},
  {page:4,lines:['Road Tax Receipt','Receipt Number:','Expiry Date: 2042-09-25','Total: RM 93.00','Email:']},
  {page:5,lines:['Motor Takaful Schedule - Page 1 of 2','Takaful Operator: Fictional Cedar Takaful','Certificate Number: SYN-CERT-2040-A','Cover Note Number: SYN-COVER-2040-B','Participant Name: Imaginary Rowan Example','Vehicle Registration: SYNTH123','Chassis Number: SYNTHCHASSIS00001','Inception Date/Time: 18 Nov 2040 14:30','Expiry Date/Time: 17 Nov 2041 23:59','Sum Covered: RM 64,000.00','NCD: 45%','Email:','Receipt Number:']},
  {page:6,lines:['Motor Takaful Schedule - Page 2 of 2','Certificate Number: SYN-CERT-2040-A','Basic Contribution: RM 1,200.00','Gross Contribution: RM 1,040.00','Tax: RM 66.80','Stamp Duty: RM 10.00','Total Contribution: RM 1,116.80','Packaged Windscreen Repair Limit: RM 650.00','Agent Name: Fictional Agent Example','Agent Email: agent-only@example.test','Agent Phone: +000 000 0000']},
  {page:7,lines:['Motor Takaful Certificate','Certificate Number: SYN-CERT-2040-A','Cover Note Number: SYN-COVER-2040-B','Participant Name: Imaginary Rowan Example','Vehicle Registration: SYNTH123','Chassis Number: SYNTHCHASSIS00001','Inception Date/Time: 18 Nov 2040 14:30','Expiry Date/Time: 17 Nov 2041 23:59']},
  {page:8,lines:['Privacy Notice','Synthetic privacy text with no policy fields.']},
  {page:9,lines:['Privacy Notice - continued','Agent Email: privacy-agent@example.test','Email:']},
];}
export const extraction=extractPolicyText([{page:1,lines:policyLines}]);
export const policyDocument={id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',case_id:caseId,uploaded_by:userId,filename:'synthetic-policy.pdf',path:caseId+'/cccccccc-cccc-4ccc-8ccc-cccccccccccc',mime_type:'application/pdf',byte_size:policyPDF().length,client_sha256:'a'.repeat(64),state:'ready',extraction,created_at:'2026-10-10T10:00:00Z'};
export function policyFixture({documents=[],record=null,canWrite=true,defer=[],source={name:'Fictional Customer',plate:'SYNTH123'}}={}){return {user:{id:userId},workspace:{case:{id:caseId,case_name:'Synthetic policy case',revision:1,source_kind:'loan',source_id:sourceId},source,can_write:canWrite,documents,record,history:[]},defer,bytes:[...policyPDF()]};}
export function policyDataMock(){return `const s=()=>window.__policyFixture;export const db={auth:{onAuthStateChange(fn){s().auth=fn}}};export const who=()=>s().call('who',[]);export const load=(...args)=>s().call('load',args);export const reserve=(...args)=>s().call('reserve',args);export const upload=(...args)=>s().call('upload',args);export const finish=(...args)=>s().call('finish',args);export const save=(...args)=>s().call('save',args);export const download=(...args)=>s().call('download',args);export const signOut=async()=>s().auth('SIGNED_OUT',null);`;}
export function initializePolicyFixture(data){
  const copy=v=>structuredClone(v),s={...copy(data),calls:[],pending:[],failures:{},settled:{},auth:null,sequence:1};
  s.release=method=>{const item=s.pending.find(x=>x.method===method&&!x.released);if(item){item.released=true;item.resolve();}};
  s.call=async(method,args)=>{
    s.calls.push({method,args:copy(args)});const snapshot=method==='load'?copy(s.workspace):null;
    try{
      if(s.defer.includes(method))await new Promise(resolve=>s.pending.push({method,resolve,released:false}));
      if(s.failures[method])throw Error(s.failures[method]);
      if(method==='who')return copy(s.user);
      if(method==='load')return snapshot;
      if(method==='reserve'){
        const [c,file,analysis]=args,existing=s.workspace.documents.find(d=>d.client_sha256===analysis.sha256);if(existing)return copy(existing);
        const id='eeeeeeee-eeee-4eee-8eee-'+String(s.sequence++).padStart(12,'0');const d={id,case_id:c.id,uploaded_by:s.user.id,filename:file.name,byte_size:file.size,mime_type:analysis.mime,client_sha256:analysis.sha256,path:c.id+'/'+id,state:'uploading',created_at:'2026-10-10T10:00:00Z'};s.workspace.documents.unshift(d);return copy(d);
      }
      if(method==='upload'){s.bytes=[...new Uint8Array(await args[1].arrayBuffer())];return;}
      if(method==='finish'){
        const d=s.workspace.documents.find(d=>d.id===args[1].id);d.state='ready';d.extraction=copy(args[2]);s.workspace.history.unshift({id:s.sequence++,case_id:d.case_id,document_id:d.id,actor:s.user.id,event:'original_uploaded',note:'Synthetic original retained.',created_at:'2026-10-10T10:00:00Z'});return copy(d);
      }
      if(method==='download')return new Blob([new Uint8Array(s.bytes)],{type:'application/pdf'});
      if(method==='save'){
        const [w,d,p]=args;
        if((w.record?.revision||0)!==(s.workspace.record?.revision||0))throw Error('Policy changed. Reload and review the latest values before saving.');
        if(w.case.revision!==s.workspace.case.revision)throw Error('Case changed. Reload before saving.');
        const before=copy(s.workspace.record?.fields||{}),origins=Object.fromEntries(Object.keys(p.patch).map(k=>[k,{document_id:d.id,method:'reviewed_local_suggestion'}]));
        s.workspace.record={fields:{...before,...copy(p.patch)},revision:(w.record?.revision||0)+1,updated_at:'2026-10-10T10:01:00Z'};
        s.workspace.history.unshift({id:s.sequence++,case_id:w.case.id,document_id:d.id,actor:s.user.id,event:'review_saved',before_fields:before,after_fields:copy(s.workspace.record.fields),provenance:origins,note:p.note,created_at:'2026-10-10T10:01:00Z'});return copy(s.workspace.record);
      }
    }finally{s.settled[method]=(s.settled[method]||0)+1;}
  };
  window.__policyFixture=s;
}
