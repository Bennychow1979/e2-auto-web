// All reads use the staff JWT; database grants and RLS enforce authorization.
export function createRentalStore(client, checkAccess) {
 const table=kind=>{if(!['contracts','settings'].includes(kind))throw Error('Unknown rental collection');return 'rental_'+kind;};
 const checked=result=>{if(result.error)throw result.error;return result.data;};
 const snapshot=row=>({id:row?.id,exists:!!row,data:()=>({...row?.data,_rental_revision:row?.revision})});
 const doc=(kind,id)=>({
  async get(){await checkAccess();return snapshot(checked(await client.from(table(kind)).select('id,data,revision').eq('id',id).maybeSingle()));},
  async set(value,revision=0){return save(kind,id,value,revision,false);},
  async update(value,revision){return save(kind,id,value,revision,true);}
 });
 async function save(kind,id,value,revision,merge){
  table(kind);await checkAccess();
  if(!Number.isSafeInteger(revision)||revision<0)throw Error('Refresh this record before saving.');
  const data={...value};delete data._rental_revision;
  return snapshot(checked(await client.rpc('rental_save',{p_table:kind,p_id:id,p_data:data,p_revision:revision,p_merge:merge})));
 }
 return {
  doc(path){const [kind,id]=path.split('/');return doc(kind,id);},
  collection(kind){return {doc:id=>doc(kind,id),onSnapshot(cb,onError){
   let active=true,running=false,again=false;
   const load=async()=>{if(!active)return;if(running){again=true;return;}running=true;
    try{await checkAccess();const data=[];for(let start=0;;start+=500){
      const batch=checked(await client.from(table(kind)).select('id,data,revision').order('id').range(start,start+499));
      data.push(...batch);if(batch.length<500)break;
     }if(active)await cb({docs:data.map(snapshot)});
    }catch(e){if(active)onError?.(e);}finally{running=false;if(again&&active){again=false;void load();}}
   };
   const channel=client.channel('rental-'+kind).on('postgres_changes',{event:'*',schema:'public',table:table(kind)},load)
    .on('postgres_changes',{event:'*',schema:'public',table:'rental_settings'},load).subscribe();
   const timer=setInterval(load,15000);void load();
   const stop=()=>{active=false;clearInterval(timer);void client.removeChannel(channel);};stop.refresh=load;return stop;
  }};}
 };
}
