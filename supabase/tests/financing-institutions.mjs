import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseInstitutionDraft, loadInstitutionDraft, institutionChecklist} from '../../financing-institutions.mjs';
import {staffLabel} from '../../financing-core.mjs';

const draft = JSON.parse(await readFile(new URL('../../config/finance-institutions.draft.json', import.meta.url),'utf8'));
const expected = ['AEON Credit','Chailease','GFS','X Star','Carsome','FS','Elk','Maybank','Public Bank','AmBank','CIMB','HLB','Bank Muamalat'];
const names = parseInstitutionDraft(draft);
assert.deepEqual(names, expected.map(name=>({name})));
const configured = [{id:'synthetic',name:'  AEON CREDIT ',active:false}];
const checklist = institutionChecklist(names,configured);
assert.equal(checklist[0].configured,configured[0]);
assert.equal(checklist.filter(item=>!item.configured).length,12);
assert.deepEqual(configured,[{id:'synthetic',name:'  AEON CREDIT ',active:false}]);
for (const mutate of [value=>value.apply_automatically=true,value=>value.institutions[0].active=true,value=>value.institutions[0].portal_url='https://unverified.example.test',value=>value.institutions[0].required_documents=[],value=>value.institutions[1].name='AEON Credit']) {
  const invalid=structuredClone(draft);mutate(invalid);assert.throws(()=>parseInstitutionDraft(invalid));
}
let requests=0;
assert.deepEqual(await loadInstitutionDraft(async(url,options)=>{
  requests++;
  assert.ok(url.pathname.endsWith('/config/finance-institutions.draft.json'));
  assert.equal(options.credentials,'omit');
  return {ok:true,json:async()=>draft};
}),names);
assert.equal(requests,1);
await assert.rejects(loadInstitutionDraft(async()=>({ok:false})),/unavailable/);
assert.equal(staffLabel({display_name:'E2 staff',email:'synthetic-office-one@example.test',user_id:'one'}),'synthetic-office-one@example.test');
assert.equal(staffLabel({display_name:' ',user_id:'two'}),'two');
assert.equal(staffLabel({display_name:'Synthetic office',user_id:'three'}),'Synthetic office');
assert.equal(staffLabel(null),'Not assigned');
console.log('PASS financing institution checklist: 13 pending names, no automatic configuration, invalid draft rejection, safe staff labels');
