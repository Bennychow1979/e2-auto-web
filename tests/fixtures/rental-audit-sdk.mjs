// Synthetic data only. Isolated tests block every external request.
const role=new URLSearchParams(location.search).get('role')||'super_admin';let superAdmin=role==='super_admin',allowed=['super_admin','admin','office_admin'].includes(role),reads=0,details=0,callbacks=[],release=null;
let user=role==='anon'?null:{id:'demo-super-admin',email:'demo@example.test'};
const ok=data=>Promise.resolve({data,error:null});const deny=()=>Promise.resolve({data:null,error:{message:'Denied'}});
export const configured=true,check=r=>{if(r.error)throw r.error;return r.data;};
export const db={auth:{onAuthStateChange(fn){callbacks.push(fn);setTimeout(()=>fn('INITIAL_SESSION',user?{user}:null),0);},getUser:()=>ok({user}),signOut:async()=>{user=null;superAdmin=false;allowed=false;callbacks.forEach(fn=>fn('SIGNED_OUT',null));return ok({});}},rpc:async(name,p={})=>{
 if(name==='e2_is_super_admin')return ok(!!user&&superAdmin);if(name==='rental_ok')return ok(!!user&&allowed);
 if(!user||!superAdmin)return deny();
 if(name==='rental_audit_list'){reads++;const rows=Array.from({length:21},(_,i)=>({id:String(100-i),actor:'demo-operator',actor_email:'operator@example.test',at:'2026-11-15T19:00:00Z',plate:i===20?'OTHER1':'DEMO1',tbl:'rental_contracts',row_id:i===20?'OTHER1':'DEMO1',action:'UPDATE',kind:'payment'}));return ok(rows.filter(r=>(!p.p_before||Number(r.id)<Number(p.p_before))&&(!p.p_plate||r.plate.includes(p.p_plate.toUpperCase()))).slice(0,p.p_limit));}
 if(name==='rental_audit_detail'){details++;if(window.auditFixture.delay)await new Promise(resolve=>release=resolve);return ok({before:{monthly:500,payments:[],notes:'<img src=x onerror=alert(1)>'},after:{monthly:600,payments:[{amount:500,paid_date:'2026-11-16',method:'TRANSFER'}],notes:'Changed'}});}
 return deny();}};
window.auditFixture={delay:false,release(){release?.();},revoke(){superAdmin=false;allowed=false;window.dispatchEvent(new Event('focus'));},logout:()=>db.auth.signOut(),snapshot:()=>({reads,details})};
