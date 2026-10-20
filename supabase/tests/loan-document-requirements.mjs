import {test} from 'node:test';import assert from 'node:assert/strict';
import {requirementItems,retainedItems,requirementSummary} from '../../loan-document-requirements.mjs';
import {documentCoverage,checklist,recentMonths} from '../../document-fields.js';
test('month choices match coverage across income types and year boundaries',()=>{
 const now=new Date(2026,9,21);
 for(const type of ['worker','commission','self_employed']){
  for(const item of checklist(type)){
   const choices=recentMonths(item.months,now,item.includeCurrentMonth);
   assert.equal(choices.length,item.months||0);
   assert.deepEqual(choices,documentCoverage(item,[],now).missing);
   if(item.months)assert.equal(choices[0],item.includeCurrentMonth?'2026-10':'2026-09');
  }
 }
 assert.deepEqual(recentMonths(3,now),['2026-09','2026-08','2026-07']);
 assert.deepEqual(recentMonths(3,new Date(2027,0,1)),['2026-12','2026-11','2026-10']);
 assert.deepEqual(recentMonths(3,new Date(2027,0,1),true),['2027-01','2026-12','2026-11']);
 const saved={status:'selected',selected_at:'2026-09-15T12:00:00Z',items:[{key:'bank_statement',months:2}]};
 const item=requirementItems('worker',saved)[0];
 assert.deepEqual(recentMonths(item.months,new Date(saved.selected_at),item.includeCurrentMonth),['2026-09','2026-08']);
 assert.equal(requirementItems('commission',saved)[0].includeCurrentMonth,true);
});
test('salary bank history counts current month salary credits without changing payslip coverage',()=>{
 const now=new Date(2026,9,21),bank=checklist('worker').find(i=>i.key==='bank_statement');
 const rows=['2026-08','2026-09','2026-10'].map(m=>({category:'bank_statement',state:'ready',covered_months:[m]}));
 assert.deepEqual(documentCoverage(bank,rows,now),{files:3,months:3,missing:[],complete:true});
 rows[2].covered_months=['2026-07'];
 assert.deepEqual(documentCoverage(bank,rows,now).missing,['2026-10']);
 assert.deepEqual(documentCoverage(checklist('worker').find(i=>i.key==='payslip'),[],now).missing,['2026-09','2026-08','2026-07']);
});
test('income defaults and explicit institution overrides',()=>{
 assert.equal(checklist('commission').some(i=>i.key==='epf'),false);
 assert.equal(checklist('self_employed').some(i=>i.key==='ssm'),true);
 const req={status:'selected',items:[{key:'bank_statement',months:6}]};
 assert.deepEqual(requirementItems('worker',req).map(i=>i.key),['bank_statement']);
 assert.equal(requirementItems('worker',{...req,status:'review_required'}).length,6);
});
test('commission bank history includes current month while payslips use six completed months',()=>{
 const now=new Date(2026,9,21),items=checklist('commission');
 const bank=items.find(i=>i.key==='bank_statement'),payslip=items.find(i=>i.key==='payslip');
 const bankMonths=['2026-10','2026-09','2026-08','2026-07','2026-06','2026-05'];
 assert.deepEqual(recentMonths(bank.months,now,bank.includeCurrentMonth),bankMonths);
 assert.deepEqual(documentCoverage(payslip,[],now).missing,['2026-09','2026-08','2026-07','2026-06','2026-05','2026-04']);
 const rows=[{category:'bank_statement',state:'ready',covered_months:bankMonths}];
 assert.equal(documentCoverage(bank,rows,now).complete,true);
 rows[0].covered_months=bankMonths.slice(1).concat('2026-04');
 assert.deepEqual(documentCoverage(bank,rows,now).missing,['2026-10']);
 const saved={status:'selected',selected_at:now.toISOString(),items:[{key:'bank_statement',months:6},{key:'payslip',months:6}]};
 const selected=requirementItems('commission',saved);
 assert.deepEqual(documentCoverage(selected[0],[],now).missing,bankMonths);
 assert.equal(selected[1].includeCurrentMonth,false);
 assert.match(selected[0].hint,/commission credited/);
 assert.equal(checklist('self_employed').find(i=>i.key==='company_bank_statement').includeCurrentMonth,undefined);
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
