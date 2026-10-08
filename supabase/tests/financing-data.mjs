import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Execute the real adapter against an in-memory connector. No Supabase/network
// module is imported, so these tests cannot read or mutate a real customer case.
const calls=[];
let tracked=true;
const caseRow={id:'case',revision:4}, application={id:'application',revision:8};
const workspace={case:caseRow,source:{id:'source',details:{name:'Synthetic'}},files:[{id:'snapshot-file'}],applications:[application]};
const db={
  from(table){calls.push({table});let response;
    const query={select(){return query},eq(){return query},order(){return Promise.resolve({data:[{id:'ready',state:'ready'},{id:'removed',removed_at:'synthetic'}]})},
      maybeSingle(){response=tracked?{id:'case'}:null;return Promise.resolve({data:response})},
      single(){return Promise.resolve({data:{id:'source',submitted_at:'2026-10-08T00:00:00Z'}})}};return query;},
  rpc(name,args){calls.push({rpc:name,args});return Promise.resolve({data:name==='e2_finance_workspace'?workspace:{ok:true}})},
};
globalThis.__financingAdapterTest={db,check:r=>{if(r.error)throw r.error;return r.data;}};
const original=await readFile(new URL('../../financing-data.js',import.meta.url),'utf8');
const source=original.replace("import {db, check} from './e2-data.js';",'const {db,check}=globalThis.__financingAdapterTest;');
const api=await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(source));
for(const kind of ['intake','loan']){
 calls.length=0;
 const result=await api.load(kind,'source');
 assert.deepEqual(result,{source:workspace.source,files:workspace.files,workspace});
 assert.deepEqual(calls,[{table:'finance_cases'},{rpc:'e2_finance_workspace',args:{target:'case'}}], 'Tracked details/files must come from one stable workspace RPC');
}
tracked=false;calls.length=0;
const start=await api.load('loan','source');assert.equal(start.workspace,null);assert.deepEqual(start.files,[{id:'ready',state:'ready'}]);
assert.deepEqual(calls.map(c=>c.table),['finance_cases','loan_applications','loan_documents']);
const checked=async(name,action,args)=>{calls.length=0;await action();assert.deepEqual(calls,[{rpc:name,args}]);};
await checked('e2_handoff_finance_case',()=>api.handoff(caseRow,'coordinator','Checked'),{target:'case',office:'coordinator',message:'Checked',expected_revision:4});
await checked('e2_assign_finance_admin',()=>api.assignAdmin(caseRow,'admin','Assigned'),{target:'case',office:'admin',message:'Assigned',expected_revision:4});
await checked('e2_select_finance_offer',()=>api.selectOffer(caseRow,application,'Explicit customer instruction'),{target:'case',application_id:'application',expected_application_revision:8,expected_revision:4,customer_instruction:'Explicit customer instruction'});
await checked('e2_record_finance_submission',()=>api.recordSubmission(application,{submitted_at:'time',external_reference:'reference',evidence:'Human confirmation'}),{target:'application',expected_revision:8,submitted_at:'time',external_reference:'reference',evidence:'Human confirmation'});
delete globalThis.__financingAdapterTest;
console.log('PASS financing adapter snapshot isolation and revision-bound RPC signatures');
