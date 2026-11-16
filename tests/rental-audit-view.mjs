import {test} from 'node:test';
import assert from 'node:assert/strict';
import {changes,valueLabel,timeLabel,actorLabel,fieldLabel} from '../rental-audit-view.mjs';
test('payment additions and field edits retain before/after values',()=>{
 const diff=changes({monthly:500,payments:[]},{monthly:600,payments:[{amount:500,paid_date:'2026-11-16'}]});
 assert.deepEqual(diff.map(x=>x.path),[['monthly'],['payments',0,'amount'],['payments',0,'paid_date']]);assert.equal(diff[0].before,500);assert.equal(diff[0].after,600);assert.equal(diff[1].before,undefined);assert.match(fieldLabel(diff[1].path),/付款记录.*第 1 项.*金额/);
});
test('null, missing, empty, zero and false remain distinct; nested order does not invent changes',()=>{
 assert.equal(new Set([undefined,null,'',0,false].map(valueLabel)).size,5);
 assert.equal(changes({a:{x:1,y:2}},{a:{y:2,x:1}}).length,0);
 assert.deepEqual(changes({a:false,b:0},{a:null,b:''}).map(x=>[x.before,x.after]),[[false,null],[0,'']]);
 assert.equal(changes({payments:[{amount:500}]},{payments:[]})[0].after,undefined);
});
test('historical identities and Malaysia dates are explicit',()=>{
 assert.equal(actorLabel({actor_display_name:'  Demo Name  ',actor_email:'staff@example.test'}),'Demo Name');assert.equal(actorLabel({actor_display_name:'  ',actor_email:'staff@example.test'}),'staff@example.test');assert.match(actorLabel({actor:null}),/系统/);assert.match(actorLabel({actor:'deleted'}),/deleted/);assert.equal(actorLabel({actor_email:'staff@example.test'}),'staff@example.test');assert.match(timeLabel('2026-11-15T19:00:00Z'),/2026.11.16.*03:00:00 MYT/);
});
