// UI is advisory; every action rechecks permissions, dependencies and revision in SQL.
export function setupVehicleLifecycle({db,check,esc,friendlyError,getCars,getRole,onRefresh,onViewChange}){
 let view='active',busy=false,ticket=0,selected=null;
 const manager=()=>['admin','super_admin'].includes(getRole());
 const tabs=document.createElement('nav');tabs.className='lifecycleTabs';tabs.setAttribute('aria-label','Vehicle records / 车辆记录');
 document.getElementById('stockList').before(tabs);
 const dialog=document.createElement('dialog');dialog.className='lifecycleDialog';dialog.setAttribute('aria-labelledby','lifecycleTitle');
 dialog.innerHTML='<form><div class="lifecycleHeading"><h2 id="lifecycleTitle">Vehicle record / 车辆记录</h2><button type="button" data-close aria-label="Close / 关闭">×</button></div><div data-details></div><label data-reason>Reason / 原因<textarea maxlength="500" rows="3" required></textarea></label><label data-plate hidden>Type the exact plate to permanently delete / 输入完整车牌确认永久删除<input autocomplete="off"></label><p data-message role="status" aria-live="polite"></p><button type="submit" data-confirm>Confirm / 确认</button></form>';
 document.body.append(dialog);
 const find=s=>dialog.querySelector(s),message=(text,error=false)=>{find('[data-message]').textContent=text;find('[data-message]').classList.toggle('error',error);};
 const labels={active:'Stock / 库存',draft:'Draft / 草稿',trash:'Recycle bin / 回收站',archived:'Archived / 已归档',purging:'Deletion incomplete / 删除待完成'};
 const state=c=>c.lifecycle_state||'active';
 const matchesView=(c,target)=>target==='draft'?state(c)==='active'&&c.publication==='draft':state(c)===target||(target==='trash'&&state(c)==='purging');
 function lock(value){busy=value;dialog.querySelectorAll('button,input,textarea').forEach(e=>e.disabled=value);}
 function reset(){ticket++;selected=null;view='active';lock(false);if(dialog.open)dialog.close();}
 function render(){
  tabs.hidden=!manager();if(!manager())view='active';
  tabs.innerHTML=['active','draft','trash','archived'].map(s=>`<button type="button" data-view="${s}" aria-pressed="${view===s}">${labels[s]} (${getCars().filter(c=>matchesView(c,s)).length})</button>`).join('');
  tabs.querySelectorAll('button').forEach(b=>b.onclick=()=>{view=b.dataset.view;onViewChange();});
 }
 const filter=rows=>rows.filter(c=>matchesView(c,view));
 function actions(c){if(!manager())return '<span>View only</span>';const s=state(c);return '<div class="lifecycleActions">'+(s==='active'?`<button class="primary" data-edit="${c.id}">Manage vehicle ↗</button><button data-life="remove" data-id="${c.id}">Remove / 移除</button>`:(s!=='purging'?`<button data-life="restore" data-id="${c.id}">Restore as draft / 恢复为草稿</button>`:'')+(['trash','purging'].includes(s)&&getRole()==='super_admin'?`<button class="danger" data-life="purge" data-id="${c.id}">${s==='purging'?'Retry deletion / 重试删除':'Permanently delete / 永久删除'}</button>`:''))+'</div>';}
 function badge(c){return state(c)==='active'?(c.publication==='published'?'Published · '+c.stock_status:'Draft · private'):labels[state(c)];}
 async function open(id,op){
  if(busy||!manager())return;const epoch=++ticket;selected=null;find('form').reset();find('[data-details]').textContent='Checking records… / 正在核对关联记录…';message('');lock(true);dialog.showModal();
  try{
   const result=check(await db.rpc('e2_vehicle_lifecycle',{target:id,operation:'inspect'}));if(epoch!==ticket||!manager())return;
   const car=result.vehicle,dependencies=Object.values(result.dependencies).reduce((a,b)=>a+Number(b),0);
   selected={car,op};find('[data-details]').innerHTML=`<p><strong>${esc(car.plate)}</strong> · ${esc([car.brand,car.model].filter(Boolean).join(' '))}</p><p>${op==='remove'?(dependencies?'This vehicle has linked records. It will be archived; jobs, bills and photos stay attached. / 此车有关联记录，只会归档，派工、账单和照片保留。':'Move to the recycle bin. Details and photos are kept and can be restored. / 移入回收站，资料和照片可恢复。'):op==='restore'?'Restore the same vehicle as a private draft. Review before publishing. / 恢复原车辆为私有草稿，核实后再发布。':'Permanently delete this vehicle and its uploaded website photos. This cannot be undone. Drive originals remain. / 永久删除车辆及网站上传照片，无法恢复；Drive 原图保留。'}</p>${car.lifecycle_reason?`<p>Reason / 原因：${esc(car.lifecycle_reason)}</p>`:''}`;
   find('[data-reason]').hidden=op!=='remove';find('textarea').required=op==='remove';find('[data-plate]').hidden=op!=='purge';find('input').required=op==='purge';
   find('[data-confirm]').textContent=op==='remove'?(dependencies?'Archive / 归档':'Move to recycle bin / 移入回收站'):op==='restore'?'Restore as draft / 恢复为草稿':'Permanently delete / 永久删除';
   lock(false);if(op==='purge'&&dependencies){selected=null;find('[data-confirm]').disabled=true;message('Linked business records prohibit permanent deletion. / 有业务记录，不允许永久删除。',true);}
  }catch(e){if(epoch===ticket){lock(false);selected=null;find('[data-confirm]').disabled=true;message(friendlyError(e),true);}}
 }
 find('[data-close]').onclick=()=>{if(!busy){ticket++;dialog.close();}};dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();else ticket++;});
 find('form').onsubmit=async e=>{
  e.preventDefault();if(busy||!selected||!manager())return;const {car,op}=selected,epoch=ticket;
  if(op==='purge'&&find('input').value!==car.plate){message('Enter the exact plate. / 请输入完整车牌。',true);return;}
  lock(true);message('Saving… / 正在保存…');
  try{
   const args={target:car.id,operation:op==='purge'?'purge_begin':op,expected_revision:car.lifecycle_revision,note:find('textarea').value.trim(),confirm_plate:find('input').value};
   const result=check(await db.rpc('e2_vehicle_lifecycle',args));
   if(op==='purge'){
    for(let i=0;i<result.paths.length;i+=100)check(await db.storage.from('vehicle-photos').remove(result.paths.slice(i,i+100)));
    check(await db.rpc('e2_vehicle_lifecycle',{...args,operation:'purge_finish',expected_revision:result.revision}));
   }
   if(epoch===ticket){selected=null;dialog.close();}await onRefresh();
  }catch(e){if(epoch===ticket){selected=null;message(friendlyError(e)+(op==='purge'?' Reopen this vehicle to retry cleanup. / 请重新打开此车重试清理。':' Close and refresh before retrying. / 请关闭并刷新后重试。'),true);}await onRefresh();}
  finally{lock(false);if(!selected)find('[data-confirm]').disabled=true;}
 };
 window.addEventListener('beforeunload',e=>{if(busy){e.preventDefault();e.returnValue='';}});
 return {render,filter,actions,badge,reset,isBusy:()=>busy,bind:()=>document.querySelectorAll('[data-life]').forEach(b=>b.onclick=()=>open(b.dataset.id,b.dataset.life))};
}
