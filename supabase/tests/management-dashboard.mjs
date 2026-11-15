import {test} from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {readFile} from 'node:fs/promises';
import {fleetSummary,stockDate,malaysiaDate} from '../functions/e2-management-dashboard/fleet.mjs';
import {createHandler,loanSummary,paged} from '../functions/e2-management-dashboard/handler.mjs';
import {dashboardView,barWidths} from '../../dashboard-view.mjs';
const now=new Date('2026-11-15T19:00:00Z');
function workbook() {
  const w=new ExcelJS.Workbook(),s=w.addWorksheet('NOV');
  s.addRows([
    ['NoPlate','DATE IN','Brand','Model'],
    ['TEST101','17/10/2026','Synthetic','One'],
    ['TEST102','16/10/2026','Synthetic','Two'],
    ['TEST103','16/09/2026','Synthetic','Three'],
    ['TEST104','16/08/2026','Synthetic','Four'],
    ['TEST105',null,'Synthetic','Five'],
    ['TEST106','17/11/2026','Synthetic','Six'],
    ['PLATE FOR SALES'],['NO8888',8000],[],
    ['PENDING DELIVERY / DONE SIGN LOAN'],['TEST107','01/09/2026','Synthetic','Seven'],
    ['SOLD & DELIVERED'],['TEST108 / OLD108','01/08/2026','Synthetic','Eight'],
    ['OKT 2026 SALES CLOSING'],['TEST109','01/07/2026','Synthetic','Nine']
  ]);return w;
}
test('MYT calendar boundaries, exact age bands, excluded plates and old closing rows',()=>{
  assert.equal(malaysiaDate(new Date('2026-10-31T16:01:00Z')),'2026-11-01');
  const r=fleetSummary(workbook(),now);
  assert.equal(r.today,'2026-11-16');assert.equal(r.stock,6);assert.equal(r.delivered,1);assert.equal(r.pending,1);
  assert.deepEqual(r.ages,[1,1,1,1]);assert.equal(r.missingDates,2);assert.equal(r.ages.reduce((a,b)=>a+b)+r.missingDates,r.stock);
});
test('literal dates only; impossible, formula, untyped serial, US and future dates are not invented',()=>{
  assert.equal(stockDate('29/02/2025'),null);assert.equal(stockDate('11/30/2026'),null);
  assert.equal(stockDate({formula:'TODAY()',result:46000}),null);assert.equal(stockDate(46000),null);
  assert.equal(stockDate('29/02/2024'),'2024-02-29');assert.equal(stockDate(new Date('2026-09-03T00:00:00Z')),'2026-09-03');
});
test('duplicate aliases, missing month and unknown section block totals',()=>{
  const w=workbook();w.getWorksheet('NOV').getRow(2).getCell(1).value='OLD108';
  assert.throws(()=>fleetSummary(w,now),/Duplicate registration/);
  assert.throws(()=>fleetSummary(workbook(),new Date('2026-12-01')),/current-month/);
  const unknown=workbook();unknown.getWorksheet('NOV').getRow(8).getCell(1).value='UNKNOWN AREA';assert.throws(()=>fleetSummary(unknown,now),/Unrecognised/);
});
test('loans count cases once and never count outcomes as approved or disbursed',()=>{
  const r=loanSummary([{id:'a',status:'Submitted to E2'},{id:'b',status:'Outcome recorded'},{id:'c',status:'Withdrawn'}],[{id:'a',status:'Needs information'},{id:'b',status:'Submitted to financier'}]);
  assert.deepEqual(r,{active:3,groups:[1,1,0,1],needsInformation:{loan:0,intake:1}});
  const action=dashboardView({loans:r}).actions[0];assert.equal(action.href,'intake-workspace.html');
  assert.throws(()=>loanSummary([{id:'a',status:'Needs information'},{id:'a',status:'Needs information'}],[]),/Duplicate/);
});
test('pagination reads beyond 1000 and propagates partial read errors',async()=>{
  const rows=Array.from({length:1203},(_,id)=>({id}));let calls=0;
  assert.equal((await paged(()=>({range:async(a,b)=>{calls++;return {data:rows.slice(a,b+1)}}}))).length,1203);assert.equal(calls,3);
  await assert.rejects(()=>paged(()=>({range:async start=>start?{error:true}:{data:rows.slice(0,500)}})),/Database/);
});
function adapters(overrides={}) {
  let reads=0;
  const read=async()=>{reads++;return {total:12,month:2}};
  return {get reads(){return reads},authenticate:async()=>({id:'test'}),membership:async()=>({active:true,role:'super_admin'}),readMembers:read,readLoans:read,readCommissions:read,readFleet:read,now:()=>now,...overrides};
}
function request(auth='Bearer synthetic',origin='https://e2auto.my'){return new Request('https://synthetic.test',{method:'POST',headers:{Authorization:auth,Origin:origin},body:'{}'})}
test('anonymous, other roles and inactive users cannot trigger any business read',async()=>{
  for(const [override,auth,status] of [
    [{},'',401],[{authenticate:async()=>null},'Bearer invalid',401],
    ...['admin','sales','customer'].map(role=>[{membership:async()=>({active:true,role})},'Bearer synthetic',403]),
    [{membership:async()=>({active:false,role:'super_admin'})},'Bearer synthetic',403]
  ]){const a=adapters(override);assert.equal((await createHandler(a)(request(auth))).status,status);assert.equal(a.reads,0)}
  const a=adapters();assert.equal((await createHandler(a)(request('Bearer synthetic','https://evil.test'))).status,403);assert.equal(a.reads,0);
});
test('authorized response has no-store, MYT month start and isolated source failures',async()=>{
  let start;const a=adapters({readMembers:async s=>{start=s;return {total:1,month:1}},readFleet:async()=>{throw Error('sensitive provider error')}});
  const response=await createHandler(a)(request());assert.equal(response.headers.get('Cache-Control'),'no-store');
  const body=await response.json();assert.equal(start,'2026-11-01T00:00:00+08:00');assert.equal(body.fleet,null);assert.deepEqual(body.errors,['fleet']);assert.equal(body.members.total,1);assert.ok(!JSON.stringify(body).includes('sensitive'));
});
test('unread metrics stay blank; genuine zeros remain zeros; proportions are bounded',()=>{
  assert.equal(dashboardView({fleet:null}).stock,'—');assert.equal(dashboardView({fleet:{stock:0}}).stock,'0');
  assert.deepEqual(barWidths([0,5,10,0]),[0,50,100,0]);assert.equal(barWidths([1,-1]),null);
  assert.equal(dashboardView({fleet:{missingDates:2,ages:[0,0,0,1],pending:1}}).actions.length,3);
});
test('rollout remains off and dispatch/password flows precede dashboard navigation',async()=>{
  const root=new URL('../../',import.meta.url),read=name=>readFile(new URL(name,root),'utf8');
  const portal=await read('portal.js'),config=await read('e2-config.js'),data=await read('e2-data.js');
  assert.match(config,/managementDashboard: false/);assert.ok(portal.indexOf('if(dispatchDraft){',portal.indexOf('async function showSession'))<portal.indexOf("location.replace('dashboard.html')"));
  assert.ok(portal.indexOf('if(recovery)return')<portal.indexOf("location.replace('dashboard.html')"));
  assert.match(portal,/get\('view'\)!=='inventory'/);assert.match(data,/'\/dashboard\.html'/);
});
test('browser denies non-Super-Admin reads and discards an in-flight response after sign-out',async()=>{
  const names=['document','location','__dashboardTest'],original=Object.fromEntries(names.map(n=>[n,Object.getOwnPropertyDescriptor(globalThis,n)]));
  const elements=new Map(),element=id=>{
    if(!elements.has(id))elements.set(id,{hidden:false,textContent:'',innerHTML:'',disabled:false,classList:{add(){},remove(){},toggle(){return false}},setAttribute(){},replaceChildren(){this.innerHTML=''}});
    return elements.get(id);
  };
  let callback,allowed=false,reads=0,finish;
  const db={rpc:async()=>({data:allowed}),auth:{onAuthStateChange:f=>{callback=f},signOut:async()=>({})},functions:{invoke:()=>{reads++;return new Promise(r=>{finish=r})}}};
  try {
    globalThis.document={getElementById:element,addEventListener(){}};globalThis.location={replace(){},hash:''};
    globalThis.__dashboardTest={db,dashboardView,barWidths};
    let source=await readFile(new URL('../../dashboard.js',import.meta.url),'utf8');
    source=source.replace(/^import .*;\r?\n/gm,'');
    source='const {db,dashboardView,barWidths}=globalThis.__dashboardTest;const configured=true,check=r=>{if(r.error)throw r.error;return r.data},esc=String;\n'+source;
    await import('data:text/javascript;charset=utf-8,'+encodeURIComponent(source));
    callback('INITIAL_SESSION',{user:{id:'not-super-admin'}});await new Promise(r=>setTimeout(r,20));
    assert.equal(reads,0);assert.equal(element('dashboard').hidden,true);
    allowed=true;callback('SIGNED_IN',{user:{id:'super-admin'}});await new Promise(r=>setTimeout(r,20));assert.equal(reads,1);
    callback('SIGNED_OUT',null);finish({data:{asOf:now.toISOString(),errors:[],members:{total:9999,month:1}}});await new Promise(r=>setTimeout(r,20));
    assert.equal(element('dashboard').hidden,true);assert.equal(element('membersTotal').textContent,'—');
  }finally{for(const n of names){if(original[n])Object.defineProperty(globalThis,n,original[n]);else delete globalThis[n]}}
});
