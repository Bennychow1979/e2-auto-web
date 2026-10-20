export const mock=`
export const configured=true,esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),friendlyError=e=>e.message;
export const check=r=>{if(r.error)throw r.error;return r.data;};
const actor='11111111-1111-4111-8111-111111111111',car='22222222-2222-4222-8222-222222222222';
let loggedIn=true,callback;
const rows={staff:[{id:actor,name:'TEST Inspector',role:'inspector'}],vehicles:[{id:car,plate:'TEST218',label:'BMW 218i — Synthetic vehicle',year:2020,stock_status:'Available'}],jobs:[]};
const events=[],photos=[],blobs=new Map();
export const db={auth:{getSession:async()=>({data:{session:loggedIn?{user:{id:actor,email:'inspector@example.test'}}:null}}),onAuthStateChange:cb=>callback=cb,signOut:async()=>{loggedIn=false;callback?.('SIGNED_OUT');return {data:null}}},
from:table=>{const filters=[];const q={select:()=>q,eq:(k,v)=>{filters.push([k,v]);return q},order:async()=>({data:(table==='e2_inspection_photos'?photos:events).filter(r=>table!=='e2_inspection_photos'||filters.every(([k,v])=>r[k]===v))})};return q;},
storage:{from:()=>({upload:async(path,file)=>{blobs.set(path,file);return {data:{path}}},download:async path=>({data:blobs.get(path)})})},
rpc:async(name,args)=>{
 if(new URLSearchParams(location.search).has('denied'))return {error:{message:'Active Inspector or Admin access required.'}};
 if(name==='e2_inspection_workspace')return {data:structuredClone(rows)};
 if(name==='e2_start_inspection'){let j={id:args.request_id,vehicle_id:args.car,assigned_to:args.assignee,status:'Pending inspection',checklist:Object.fromEntries(['cushion','windscreen','engine','transmission','brakes','tyres','body','electrical','road_test'].map(k=>[k,'unchecked'])),findings:'',workshop:'',repair_date:null,repair_time:null,repair_notes:'',completion_notes:'',revision:1};rows.jobs.push(j);return {data:structuredClone(j)}};
 if(name==='e2_save_inspection'){let j=rows.jobs.find(j=>j.id===args.target);Object.assign(j,args.changes,{revision:j.revision+1});events.push({action:j.status,snapshot:structuredClone(j),created_at:'2026-10-20T03:00:00Z'});return {data:structuredClone(j)}};
 if(name==='e2_reserve_inspection_photo'){let p=photos.find(p=>p.id===args.request_id);if(!p){p={id:args.request_id,inspection_id:args.target,category:args.photo_category,caption:args.photo_caption,filename:args.file_name,path:args.target+'/'+args.request_id,state:'uploading',created_at:new Date().toISOString()};photos.push(p)}return {data:structuredClone(p)}};
 if(name==='e2_finish_inspection_photo'){const p=photos.find(p=>p.id===args.photo_id);p.state='ready';return {data:structuredClone(p)}};
 throw Error(name);
}};`;
