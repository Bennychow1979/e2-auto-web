import ExcelJS from 'exceljs';
export const when={year:2026,month:10},now=new Date('2026-10-16T10:00:00Z');
export function fixture({months=1,rows=31,columns=10}={}) {
  const w=new ExcelJS.Workbook();
  const names=['OCT','JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEPT','NOV','DEC'];
  for(let n=0;n<months;n++) {
    const s=w.addWorksheet(names[n]);
    s.addRow(['MUDAH PRICE','No Plate','Brand','Model','YRS','CC','A/M','DATE IN','PROFIT','CUSTOMER',...Array.from({length:Math.max(0,columns-10)},(_,i)=>'INTERNAL '+i)]);
    for(let i=0;i<rows;i++)s.addRow([50000+i,'TEST'+(1000+i),'BMW','218I',2021,1.5,'A',new Date('2026-10-01'),99999,'PRIVATE_SYNTHETIC_'+n+'_'+i,...Array.from({length:Math.max(0,columns-10)},(_,j)=>'synthetic '+n+' '+i+' '+j)]);
  }
  return w;
}
export function fakeWorld(buffer,count=31) {
  const root='root_synthetic',folders=Array.from({length:count},(_,i)=>({id:'folder_'+String(i).padStart(4,'0'),name:'TEST'+(1000+i),mimeType:'application/vnd.google-apps.folder',parents:[root]}));
  const photos=f=>[{id:'photo_'+f.id,name:'1.jpg',mimeType:'image/jpeg',size:100,md5Checksum:'b'.repeat(32),parents:[f.id],capabilities:{canDownload:true}}];
  const state={source:{mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',md5Checksum:'a'.repeat(32),version:'1'},inventory:[],jobs:new Map(),saved:new Map(),downloads:0,lists:[],broken:new Map(),commits:0,failAfterCommit:false};
  const drive={list:async id=>{state.lists.push(id);if(id===root)return folders;if(state.broken.has(id))throw state.broken.get(id);return photos(folders.find(f=>f.id===id))},metadata:async id=>id===root?{}:folders.find(f=>f.id===id)||state.source,workbook:async()=>{state.downloads++;return buffer},image:async()=>{throw Error('PHOTO_DOWNLOAD_FORBIDDEN')}};
  const store={inventory:async()=>state.inventory,jobs:async()=>state.jobs,save:async job=>state.jobs.set(job.folder_id,job),commit:async({folder,plan})=>{
    state.commits++;
    if(state.inventory.some(v=>v.plate===plan.vehicle.plate))return {status:'existing'};
    state.inventory.push({plate:plan.vehicle.plate});state.saved.set(folder,plan);state.jobs.set(folder,{status:'completed'});
    if(state.failAfterCommit){state.failAfterCommit=false;throw Error('Uncertain save')}
    return {status:'created',vehicle_id:folder};
  },verify:async id=>{const p=state.saved.get(id);return {publication:'draft',price:p.vehicle.price,photos:p.items.map(i=>({file_id:i.file_id}))}}};
  return {root,actor:'synthetic',folders,drive,store,state,now};
}
