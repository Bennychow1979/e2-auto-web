import {test} from 'node:test';import assert from 'node:assert/strict';
import {requirementItems,retainedItems,requirementSummary} from '../../loan-document-requirements.mjs';
import {documentCoverage,checklist} from '../../document-fields.js';
test('income defaults and explicit institution overrides',()=>{
 assert.equal(checklist('commission').some(i=>i.key==='epf'),false);
 assert.equal(checklist('self_employed').some(i=>i.key==='ssm'),true);
 const req={status:'selected',items:[{key:'bank_statement',months:6}]};
 assert.deepEqual(requirementItems('worker',req).map(i=>i.key),['bank_statement']);
 assert.equal(requirementItems('worker',{...req,status:'review_required'}).length,6);
});
test('coverage counts distinct requested completed months only, never verification',()=>{
 const rows=['2026-09','2026-09','2026-08','2025-01','2099-01','2026-10'].map(m=>({category:'payslip',state:'ready',covered_months:[m]}));
 rows.push({category:'payslip',state:'uploading',covered_months:['2026-07']},{category:'payslip',state:'ready',removed_at:'x',covered_months:['2026-07']});
 const item={key:'payslip',label:'Payslips',months:3},now=new Date(2026,9,20);
 assert.deepEqual(documentCoverage(item,rows,now),{files:6,months:2,missing:['2026-07'],complete:false});
 rows.push({category:'payslip',state:'ready',covered_months:['2026-07']});
 assert.match(requirementSummary([item],rows,{status:'selected',selected_at:now.toISOString()}),/verification is still needed/);
});
test('old files remain visible without becoming new requirements',()=>{
 const old=retainedItems([{key:'ssm'}],[{category:'epf',state:'ready'},{category:'epf',state:'ready'},{category:'ic_front',removed_at:'x'}]);
 assert.equal(old.length,1);assert.equal(old[0].key,'epf');assert.equal(old[0].retained,true);
 assert.match(requirementSummary([],[],null),/Choose/);
});
