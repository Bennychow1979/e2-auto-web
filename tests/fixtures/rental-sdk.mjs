// Synthetic-only SDK for isolated browser checks. No real account or record.
const role=new URLSearchParams(location.search).get('role')||'super_admin';
let current=role==='anon'?null:{id:'00000000-0000-4000-8000-000000000001',email:'demo@example.test'};
let allowed=['super_admin','office_admin'].includes(role),listeners=[],channels=[],reads=0;
const contracts=[{id:'DEMO1',revision:1,data:{plate:'DEMO1',brand:'DEMO',model:'TEST',year:2020,owner_name:'SYNTHETIC OWNER',monthly:500,tenure:60,first_payment_date:'2026-08-12',paid_count_excel:0,payments:[],handovers:[],car_status:'SOLD',financier:'DEMO',history:[]}}];
let nextSave=null,releaseSave=null,stockError=false,stockPending=null,releaseStock=null;
const vehicles=[
 {id:'stock-demo',plate:'DEMO1',brand:'DEMO',model:'TEST',variant:'',year:2020,stock_status:'Sold',lifecycle_state:'active'},
 {id:'stock-1234',plate:'ABC1234',brand:'HONDA',model:'CITY',variant:'V',year:2021,stock_status:'Available',lifecycle_state:'active'},
 {id:'stock-5678',plate:'XYZ5678',brand:'TOYOTA',model:'VIOS',variant:'G',year:2022,stock_status:'Booked',lifecycle_state:'active'},
 {id:'stock-unsafe',plate:'XSS1',brand:'<img src=x onerror=alert(1)>',model:'TEST',year:2020,stock_status:'Available',lifecycle_state:'active'},
 {id:'stock-archived',plate:'ARCHIVED1',brand:'DEMO',model:'OLD',year:2020,lifecycle_state:'archived'}
];
let settings={id:'lists',revision:1,data:{agents:['DEMO AGENT'],financiers:[{code:'DEMO',name:'Demo lender',bank:'DEMO'}],partners:[]}};
const success=data=>Promise.resolve({data,error:null});const fail=message=>Promise.resolve({data:null,error:{message}});
export const configured=true;export const check=r=>{if(r.error)throw r.error;return r.data;};
export const db={
 auth:{onAuthStateChange(fn){listeners.push(fn);setTimeout(()=>fn('INITIAL_SESSION',current?{user:current}:null),0);},getUser:()=>success({user:current}),
  signInWithPassword:async()=>{current={id:'00000000-0000-4000-8000-000000000001',email:'demo@example.test'};allowed=true;listeners.forEach(fn=>fn('SIGNED_IN',{user:current}));return success({session:{user:current}});},
  signOut:async()=>{current=null;allowed=false;listeners.forEach(fn=>fn('SIGNED_OUT',null));return success({});}},
 rpc:async(name,p={})=>{
  if(name==='rental_identity')return current&&allowed?success({user_id:current.id,display_name:role==='super_admin'?'Demo Manager':current.email}):fail('Denied');
  if(name==='rental_ok')return success(!!current&&allowed);
  if(name==='e2_is_super_admin')return success(role==='super_admin');
  if(name==='rental_list_access')return role==='super_admin'?success([{user_id:'00000000-0000-4000-8000-000000000002',email:'office@example.test',role:'office_admin',active:true,enabled:false,revision:0}]):fail('Denied');
  if(name==='rental_set_access')return role==='super_admin'?success(null):fail('Denied');
  if(name==='rental_save'){
   if(nextSave){const pending=nextSave;nextSave=null;await pending;}
   if(!allowed)return fail('Denied');const items=p.p_table==='contracts'?contracts:[settings];let row=items.find(r=>r.id===p.p_id);
   if((row?.revision||0)!==p.p_revision)return fail('Record changed. Refresh and try again; your change was not saved.');
   if(!row){row={id:p.p_id,revision:0,data:{}};items.push(row);}
   row.data=p.p_merge?{...row.data,...p.p_data}:p.p_data;row.revision++;
   setTimeout(()=>channels.forEach(fn=>fn()),10);return success(structuredClone(row));
  }return fail('Unexpected RPC');
 },
 from(table){
  if(table==='vehicles'){let filters=[];return {select(){return this;},eq(k,v){filters.push([k,v]);return this;},order(){return this;},async range(start,end){reads++;const captured=vehicles.filter(v=>filters.every(([k,value])=>v[k]===value)).slice(start,end+1);if(stockPending){const pending=stockPending;stockPending=null;await pending;}return stockError?fail('Stock unavailable'):success(structuredClone(captured));}};}
  let id;const result=()=>{reads++;if(!allowed)return {data:[],error:null};const data=table==='rental_contracts'?contracts:[settings];return {data:structuredClone(id?data.filter(r=>r.id===id):data),error:null};};return {
  select(){return this;},eq(k,v){id=v;return this;},order(){return this;},range(){return Promise.resolve(result());},maybeSingle(){const r=result();return success(r.data[0]||null);}
 };},
 channel(){let cb;return {on(type,filter,fn){cb=fn;return this;},subscribe(){channels.push(cb);return this;}};},removeChannel:async()=>{}
};
window.rentalFixture={stockError(value){stockError=value;},holdStock(){stockPending=new Promise(resolve=>releaseStock=resolve);},releaseStock(){releaseStock();},holdSave(){nextSave=new Promise(resolve=>releaseSave=resolve);},releaseSave(){releaseSave();},refresh:()=>Promise.all(channels.map(fn=>fn())),revoke(){allowed=false;channels.forEach(fn=>fn());},snapshot(){return {reads,contracts:structuredClone(contracts)};},conflict(){contracts[0].revision++;}};
