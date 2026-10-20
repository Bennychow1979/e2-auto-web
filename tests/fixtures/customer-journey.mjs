// Synthetic SDK boundary only. Production UI and all customer data adapters run unchanged.
// Actual SQL/RLS is independently exercised by the PGlite suites, not this fixture.
export const alice='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',bob='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const aliceLoan='11111111-1111-4111-8111-111111111111',bobLoan='22222222-2222-4222-8222-222222222222';
export function initializeCustomerJourney(options={}){
 if(!['http:','https:'].includes(location.protocol))return;
 const key='e2-synthetic-journey',customerKey='e2-customer-auth',staffKey='e2-staff-auth';
 const alice='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',bob='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
 const ids=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
 const stamp=()=>new Date(Date.UTC(2026,0,1,0,0,++state.sequence)).toISOString();
 const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
 const account=(id,name)=>({id,email:name.toLowerCase()+'@example.test',email_confirmed_at:'2026-01-01T00:00:00Z',user_metadata:{},active:true,password:'Synthetic-only-123!'});
 const app=(id,owner,name)=>({id,customer_id:owner,vehicle_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',vehicle_summary:{name,plate:'SYNTHETIC',year:2020,variant:'Test only',price:80000},status:'Submitted to E2',details:{name:owner===alice?'Alice Example':'Bob Example',email:owner===alice?'alice@example.test':'bob@example.test'},last_step:6,applicant_type:'worker',revision:1,submitted_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z'});
 let state=JSON.parse(localStorage.getItem(key)||'null')||{sequence:10,sessions:{[customerKey]:options.session===false?null:alice,[staffKey]:'synthetic-staff'},accounts:{[alice]:account(alice,'Alice'),[bob]:account(bob,'Bob')},profiles:{[alice]:{user_id:alice,full_name:'Alice Example',phone:'60111111111',revision:1,privacy_version:'synthetic'},[bob]:{user_id:bob,full_name:'Bob Example',phone:'60222222222',revision:1,privacy_version:'synthetic'}},apps:{[ids[0]]:app(ids[0],alice,'Alice private vehicle'),[ids[1]]:app(ids[1],bob,'Bob private vehicle')},events:{[ids[0]]:[{event:'Submitted to E2',note:'Alice private progress',created_at:'2026-01-01T00:00:00Z'}],[ids[1]]:[{event:'Submitted to E2',note:'Bob private progress',created_at:'2026-01-01T00:00:00Z'}]},docs:{},blobs:{},calls:[],failures:{}};
 const listeners=new Map(),held=new Map((options.hold||[]).map(op=>[op,true])),pending=[];
 const save=()=>localStorage.setItem(key,JSON.stringify(state));save();
 const session=k=>state.accounts[state.sessions[k]]?{user:clone(state.accounts[state.sessions[k]])}:null;
 const notify=(k,event)=>{for(const callback of listeners.get(k)||[])callback(event,session(k));};
 window.addEventListener('storage',e=>{if(e.key!==key||!e.newValue)return;const old=state.sessions;state=JSON.parse(e.newValue);for(const k of [customerKey,staffKey])if(old[k]!==state.sessions[k])notify(k,state.sessions[k]?'SIGNED_IN':'SIGNED_OUT');});
 const record=(op,extra={})=>{state.calls.push({op,...extra});save();};
 async function action(op,fn){record(op);let data,error;try{const fail=state.failures[op];if(fail==='before'){delete state.failures[op];save();throw Error('Synthetic interrupted '+op);}data=await fn();if(fail==='after'){delete state.failures[op];save();throw Error('Synthetic lost response '+op);}}catch(e){error={message:e.message,code:e.code};}
  if(held.has(op))await new Promise(resolve=>pending.push({op,resolve}));return {data:clone(data),error:error||null};}
 const requireOwner=(a,id)=>{if(!id||!a||a.customer_id!==id)throw Error('Application unavailable for this customer.');return a;};
 const revise=a=>{a.revision++;a.updated_at=stamp();save();return a;};
 function client(storageKey){const current=()=>state.sessions[storageKey];
  const auth={
   getSession:()=>action('getSession',()=>({session:session(storageKey)})),
   getUser:()=>action('getUser',()=>({user:session(storageKey)?.user||null})),
   onAuthStateChange(callback){if(!listeners.has(storageKey))listeners.set(storageKey,new Set());listeners.get(storageKey).add(callback);setTimeout(()=>callback(options.recovery?'PASSWORD_RECOVERY':'INITIAL_SESSION',session(storageKey)),0);return {data:{subscription:{unsubscribe:()=>listeners.get(storageKey).delete(callback)}}};},
   signInWithPassword:input=>action('signIn',()=>{const user=Object.values(state.accounts).find(u=>u.email===input.email&&u.password===input.password);if(!user||!user.email_confirmed_at)throw Error('Invalid synthetic login');state.sessions[storageKey]=user.id;save();notify(storageKey,'SIGNED_IN');return {user,session:session(storageKey)};}),
   signUp:input=>action('signUp',()=>{const id='dddddddd-dddd-4ddd-8ddd-'+String(++state.sequence).padStart(12,'0');state.accounts[id]={id,email:input.email,password:input.password,email_confirmed_at:null,active:true,user_metadata:input.options.data};save();return {user:state.accounts[id],session:null};}),
   resetPasswordForEmail:()=>action('resetEmail',()=>({})),resend:()=>action('resendEmail',()=>({})),
   updateUser:input=>action('updatePassword',()=>{if(!current())throw Error('No synthetic session');state.accounts[current()].password=input.password;save();return {user:state.accounts[current()]};}),
   signOut:()=>action('signOut',()=>{state.sessions[storageKey]=null;save();notify(storageKey,'SIGNED_OUT');return {};})
  };
  function from(table){const filters=[];let one=false,maybe=false;const q={select(){return q},eq(k,v){filters.push([k,v]);return q},order(){return q},range(){return q},limit(){return q},single(){one=true;return q},maybeSingle(){one=true;maybe=true;return q},then(resolve,reject){return action('select:'+table,()=>{const actor=current();let rows=[];
   if(table==='customer_profiles')rows=Object.values(state.profiles).filter(x=>x.user_id===actor);
   if(table==='loan_applications')rows=Object.values(state.apps).filter(x=>x.customer_id===actor);
   if(table==='loan_events'){const appId=filters.find(([k])=>k==='application_id')?.[1];requireOwner(state.apps[appId],actor);rows=state.events[appId]||[];}
   if(table==='loan_documents')rows=Object.values(state.docs).filter(x=>state.apps[x.application_id]?.customer_id===actor);
   if(table==='vehicles')rows=[{id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',brand:'Synthetic',model:'Example',variant:'Local only',year:2020,price:80000,plate:'SYNTHETIC',stock_status:'Available',publication:'published',vehicle_photos:[]}];
   if(table==='staff_memberships')rows=[];
   rows=rows.filter(row=>filters.every(([k,v])=>table==='loan_events'&&k==='application_id'||row[k]===v));if(one){if(!rows.length&&!maybe)throw Error('Application unavailable for this customer.');return clone(rows[0]||null)}return clone(rows);
  }).then(resolve,reject)}};return q;}
  async function rpc(name,p={}){return action('rpc:'+name,()=>{const actor=current();if(name==='e2_customer_allowed')return !!(state.accounts[actor]?.active&&state.accounts[actor]?.email_confirmed_at);if(!actor)throw Error('Sign in to continue.');
   if(name==='e2_save_customer_profile'){const prior=state.profiles[actor];if((prior?.revision||0)!==p.expected_revision)throw Error('Profile changed. Reload before saving.');state.profiles[actor]={...prior,...p.details,user_id:actor,revision:(prior?.revision||0)+1};save();return state.profiles[actor];}
   if(name==='e2_start_loan'){const prior=Object.values(state.apps).find(a=>a.customer_id===actor&&a.vehicle_id===p.vehicle&&a.status==='Draft');if(prior)return prior;const id='eeeeeeee-eeee-4eee-8eee-'+String(++state.sequence).padStart(12,'0');const a={...app(id,actor,'Synthetic new vehicle'),vehicle_id:p.vehicle,details:{},status:'Draft',submitted_at:null,last_step:0,applicant_type:null};state.apps[id]=a;state.events[id]=[];save();return a;}
   if(['e2_save_loan','e2_submit_loan','e2_set_applicant_type'].includes(name)){const a=requireOwner(state.apps[p.target],actor);if(a.revision!==p.expected_revision)throw Error('Application changed. Reload before saving.');if(name==='e2_save_loan'){a.details=clone(p.details);a.last_step=p.step;}if(name==='e2_set_applicant_type')a.applicant_type=p.kind;if(name==='e2_submit_loan'){a.status='Submitted to E2';a.submitted_at=stamp();state.events[a.id].push({event:a.status,note:'Synthetic submission received',created_at:stamp()});}return revise(a);}
   if(name==='e2_loan_document_requirements'){requireOwner(state.apps[p.target],actor);return {status:'unassigned'};}
   if(name==='e2_reserve_document'){const a=requireOwner(state.apps[p.target],actor);if(!['Draft','Submitted to E2','Needs information'].includes(a.status))throw Error('Documents are read-only');const id='ffffffff-ffff-4fff-8fff-'+String(++state.sequence).padStart(12,'0');const d={id,application_id:a.id,path:a.id+'/'+id,category:p.doc_category,filename:p.file_name,mime_type:p.file_mime,byte_size:p.file_bytes,covered_months:p.months||[],state:'uploading',removed_at:null};state.docs[id]=d;save();return d;}
   if(['e2_finish_document','e2_remove_document'].includes(name)){const d=state.docs[p.document_id];requireOwner(state.apps[d?.application_id],actor);if(name==='e2_finish_document'){if(!state.blobs[d.path])throw Error('Upload missing');d.state='ready';if(p.replaces&&state.docs[p.replaces])state.docs[p.replaces].removed_at=stamp();}else d.removed_at=stamp();save();return d;}
   throw Error('Unexpected synthetic RPC '+name);
  });}
  const storage={from:()=>({upload:async(file,blob)=>{const data=[...new Uint8Array(await blob.arrayBuffer())];return action('upload',()=>{const doc=Object.values(state.docs).find(d=>d.path===file);requireOwner(state.apps[doc?.application_id],current());if(state.blobs[file])throw Error('Duplicate object');state.blobs[file]={bytes:data,type:blob.type};save();return {path:file};});},remove:files=>action('removeObject',()=>{for(const file of files){const d=Object.values(state.docs).find(d=>d.path===file);requireOwner(state.apps[d?.application_id],current());delete state.blobs[file];}save();return [];}),download:async file=>{const result=await action('download',()=>{const d=Object.values(state.docs).find(d=>d.path===file);requireOwner(state.apps[d?.application_id],current());if(d.removed_at||!state.blobs[file])throw Error('File unavailable');return state.blobs[file];});return result.error?result:{data:new Blob([new Uint8Array(result.data.bytes)],{type:result.data.type}),error:null};}})};
  return {auth,from,rpc,storage};
 }
 window.__customerFixture={client,snapshot:()=>clone(state),hold:op=>held.set(op,true),release:op=>{held.delete(op);for(const p of pending.filter(x=>x.op===op))p.resolve();},fail:(op,when='before')=>{state.failures[op]=when;save();},switchUser:(id,event='SIGNED_IN',k=customerKey)=>{state.sessions[k]=id;save();notify(k,event);},confirm:email=>{const a=Object.values(state.accounts).find(x=>x.email===email);a.email_confirmed_at=stamp();save();},progress:(id,status,note)=>{const a=state.apps[id];a.status=status;revise(a);state.events[id].push({event:status,note,created_at:stamp()});save();}};
}

export const sdkMock=`export const createClient=(url,key,options)=>window.__customerFixture.client(options.auth.storageKey);`;
