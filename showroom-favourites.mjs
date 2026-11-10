// Account-backed shortlist state, independent of filtering and view changes.
export function createFavourites({customer,savedRows,setSaved,onChange,onAuthRequired}){
  let ids=new Set(),busy=null,epoch=0,request=0;
  const state=()=>({ids:new Set(ids),busy});
  const emit=(message='')=>onChange(state(),message);
  async function refresh(){
    if(busy)return;
    const run=++request,session=epoch;
    try{
      const user=await customer(),rows=user?await savedRows():[];
      if(run!==request||session!==epoch)return;
      ids=new Set(rows.map(row=>row.vehicle_id));emit();
    }catch{if(run===request&&session===epoch)emit('Could not check your saved cars. Try Save car again.')}
  }
  async function toggle(id){
    if(busy)return;
    busy=id;request++;const session=epoch;emit();
    try{
      const user=await customer();if(session!==epoch)return;
      if(!user){onAuthRequired(id);return}
      const rows=await savedRows();if(session!==epoch)return;
      ids=new Set(rows.map(row=>row.vehicle_id));
      const keep=!ids.has(id),saved=await setSaved(id,keep);
      if(session!==epoch)return;
      if(saved)ids.add(id);else ids.delete(id);
      emit(saved?'Saved to your account.':'Removed from your saved cars.');
    }catch(error){if(session===epoch)emit(error.message||'Could not save. Please try again.')}
    finally{busy=null;onChange(state());if(session!==epoch)void refresh()}
  }
  function reset(){epoch++;request++;ids.clear();emit()}
  return {state,refresh,toggle,reset};
}
