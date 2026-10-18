import {t,errorText,locale,applyLanguage,setLanguage,getLanguage,storageKey} from './mileage-i18n.mjs?v=1';
import {mileageAPI as api} from './mileage-data.js?v=ui-1';
import {MAX_PHOTO_BYTES,MAX_PHOTO_SIDE,MAX_PHOTO_PIXELS,mileageEnabled,inspectDraft,normalizeMileage,localDateTime,reasonText} from './mileage-core.mjs?v=ui-1';
const $=id=>document.getElementById(id),allowedRoles=new Set(['sales','admin','super_admin']);
let epoch=0,carEpoch=0,photoEpoch=0,ctx=null,identity=null,photo=null,pending=null,history=[],historyLoaded=false,vehicles=[],busy=false,loadingPhoto=false,historyURL=null,dialogEpoch=0;
const messages=new Map();
const rawTextIds=new Set(['identity','actor','photoName']);
const resolveText=(id,value)=>{const result=typeof value==='function'?value():value;return rawTextIds.has(id)?result:t(result);};
const text=(id,value)=>{messages.set(id,value);$(id).textContent=resolveText(id,value);};
function renderVehicles(){
 const selected=$('vehicle').value,query=$('vehicleSearch').value.trim().toLocaleLowerCase().replace(/\s/g,'');
 const matches=vehicles.filter(v=>(v.plate+' '+v.brand+' '+v.model).toLocaleLowerCase().replace(/\s/g,'').includes(query));
 const current=vehicles.find(v=>v.id===selected),retained=Boolean(current&&!matches.includes(current));
 const options=retained?[current,...matches]:matches;
 $('vehicle').replaceChildren(...options.map(car=>{const option=document.createElement('option');option.value=car.id;option.textContent=car.plate+' · '+car.brand+' '+car.model+(car.publication==='draft'?' · '+t('草稿'):'')+(retained&&car===current?' · '+t('当前选择'):'');return option;}));
 if(current)$('vehicle').value=selected;
 $('searchStatus').hidden=!query;text('searchStatus',()=>matches.length?t('找到 {count} 辆车。',{count:matches.length}):t('没有匹配的车辆。请尝试其他车牌、品牌或车型。'));
}
function refreshLanguage(){
 applyLanguage();$('language').value=getLanguage();
 for(const [id,value] of messages)$(id).textContent=resolveText(id,value);
 renderVehicles();if(ctx)showContext();if(historyLoaded)renderHistory();warn();
}
try{setLanguage(localStorage.getItem(storageKey));}catch{setLanguage('en');}
applyLanguage();$('language').value=getLanguage();
$('language').addEventListener('change',()=>{setLanguage($('language').value);try{localStorage.setItem(storageKey,getLanguage());}catch{}refreshLanguage();});
$('vehicleSearch').addEventListener('input',renderVehicles);
function clearPhoto(){photoEpoch++;if(photo?.url)URL.revokeObjectURL(photo.url);photo=null;loadingPhoto=false;$('photoInput').value='';$('photoPreview').hidden=true;$('photoImage').removeAttribute('src');text('photoStatus','');}
function closePhoto(){dialogEpoch++;if(historyURL)URL.revokeObjectURL(historyURL);historyURL=null;$('historyPhoto').removeAttribute('src');$('historyPhoto').hidden=true;if($('photoDialog').open)$('photoDialog').close();}
function clearPrivate(){epoch++;carEpoch++;ctx=null;identity=null;pending=null;history=[];historyLoaded=false;vehicles=[];$('vehicleSearch').value='';$('searchStatus').hidden=true;clearPhoto();closePhoto();$('work').hidden=true;$('history').replaceChildren();$('vehicle').replaceChildren();text('identity','');text('actor','');text('staffIdentity','');$('staffIdentity').hidden=true;text('currentMileage','');text('publication','');text('roleNotice','');text('announcement','');$('mileageForm').reset();busy=false;}
function message(value,error=false){text('state',value);$('state').hidden=!value;$('state').classList.toggle('error',error);}
function formError(error){text('formError',()=>errorText(error));$('formError').hidden=false;}
function draft(){return {reading:$('reading').value,unit:$('unit').value,time:$('checkedAt').value,note:$('note').value,vehicleChecked:$('vehicleChecked').checked,unitChecked:$('unitChecked').checked};}
function controls(){const can=Boolean(ctx?.can_submit===true&&allowedRoles.has(identity?.role));$('fields').disabled=!can||busy||Boolean(pending);$('submit').disabled=!can||busy||loadingPhoto;$('vehicle').disabled=busy||Boolean(pending);$('vehicleSearch').disabled=busy||Boolean(pending);$('reload').disabled=busy||Boolean(pending);$('removePhoto').disabled=busy||Boolean(pending);$('moreHistory').disabled=busy;warn();}
function warn(){if(pending){text('submit','重试同一提交 →');return;}const unitChanged=ctx&&$('unit').value!==(ctx.last_applied_unit||'km');$('unitNotice').hidden=!unitChanged;let reasons=[];
 if(ctx){try{const d=draft(),km=normalizeMileage(d.reading,d.unit).km,when=Date.parse(d.time);if(ctx.vehicle.mileage!==null&&km<ctx.vehicle.mileage)reasons.push('读数低于现有记录');if(ctx.last_applied_at&&Number.isFinite(when)&&when<Date.parse(ctx.last_applied_at))reasons.push('检查时间早于最近已带入的记录');}catch{}}
 $('warning').hidden=!reasons.length;text('warning',()=>t('警告汇总',{reasons:reasons.map(reason=>t(reason)).join(getLanguage()==='zh'?'；':'; ')}));text('submit',reasons.length?'保存异常记录（不回填） →':'提交并更新里程 →');
}
function showContext(){const v=ctx.vehicle;text('identity',`${v.plate} · ${v.year} ${v.brand} ${v.model}`);text('currentMileage',()=>v.mileage===null?t('尚未登记'):t('当前里程格式',{value:Number(v.mileage).toLocaleString(locale())}));text('publication',()=>v.publication==='draft'?t('草稿 · 尚未公开'):t('已发布')+' · '+t(v.stock_status));text('actor',ctx.actor.name);$('roleNotice').hidden=ctx.can_submit;text('roleNotice',allowedRoles.has(identity?.role)?'里程登记尚未启用，检查历史仍可查看。':'当前账号没有里程登记权限。');}
function renderHistory(){const box=$('history');box.replaceChildren();if(!history.length){const p=document.createElement('p');p.className='historyEmpty';p.textContent=t('这辆车暂无检查记录。');box.append(p);return;}
 for(const row of history){const article=document.createElement('article');article.className='historyItem';const top=document.createElement('div');top.className='historyTop';const reading=document.createElement('strong');reading.className='historyReading';reading.textContent=`${Number(row.reading).toLocaleString(locale())} ${row.unit}`;const status=document.createElement('span');status.className='badge'+(row.result==='applied'?'':' blocked');status.textContent=t(row.result==='applied'?'已带入':'仅留档 · 未回填');top.append(reading,status);article.append(top);
  for(const line of [`${new Date(row.inspected_at).toLocaleString(locale())} · ${row.actor_name}`,row.note,(row.reasons||[]).map(reason=>t(reasonText(reason))).join(getLanguage()==='zh'?'；':'; ')].filter(Boolean)){const p=document.createElement('p');p.textContent=line;article.append(p);}
  const button=document.createElement('button');button.type='button';button.className='quiet';button.textContent=t('查看仪表照片');button.addEventListener('click',()=>viewPhoto(row));article.append(button);box.append(article);
 }
}
async function loadVehicle({keepDraft=false}={}){const id=$('vehicle').value,turn=++carEpoch,authTurn=epoch;if(!id)return;ctx=null;pending=null;history=[];historyLoaded=false;closePhoto();if(!keepDraft){clearPhoto();$('mileageForm').reset();$('checkedAt').value=localDateTime();}controls();text('history','正在载入历史…');$('formError').hidden=true;
 try{const next=await api.context(id);if(turn!==carEpoch||authTurn!==epoch)return;if(next.vehicle.id!==id||next.actor.id!==identity.id||next.actor.role!==identity.role)throw Error('会话或车辆已变化，请重新载入。');ctx=next;showContext();const rows=await api.history(id);if(turn!==carEpoch||authTurn!==epoch)return;history=rows;historyLoaded=true;renderHistory();$('moreHistory').hidden=rows.length<25;controls();}
 catch(error){if(turn!==carEpoch||authTurn!==epoch)return;ctx=null;text('history','无法读取历史，请重新载入。');text('identity','');text('currentMileage','');formError(error);controls();}
}
async function boot(){const turn=++epoch;message('正在检查员工会话…');if(!mileageEnabled()){message('里程登记尚未启用。');return;}if(!api){message('员工连接尚未配置。',true);return;}
 try{const who=await api.identity();if(turn!==epoch)return;if(!who||!allowedRoles.has(who.role)){message('请使用有库存权限的员工账号登录。',true);return;}identity=who;text('staffIdentity',()=>t('员工身份格式',{role:t({sales:'Sales',admin:'Admin',super_admin:'Super Admin'}[who.role])}));$('staffIdentity').hidden=false;const cars=await api.vehicles();if(turn!==epoch)return;vehicles=cars;renderVehicles();const target=new URLSearchParams(location.search).get('vehicle');if(cars.some(v=>v.id===target))$('vehicle').value=target;$('work').hidden=false;message(cars.length?'':'当前没有可登记的车辆。');if(cars.length)await loadVehicle();}
 catch(error){if(turn===epoch)message(()=>errorText(error)||t('无法验证员工会话。'),true);}
}
async function choosePhoto(){const file=$('photoInput').files[0];clearPhoto();if(!file||ctx?.can_submit!==true)return;const turn=photoEpoch,carTurn=carEpoch;loadingPhoto=true;controls();text('photoStatus','正在读取照片…');
 try{if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size<1||file.size>MAX_PHOTO_BYTES)throw Error('请选择不超过 5 MiB 的 JPEG、PNG 或 WebP 照片。');const bitmap=await createImageBitmap(file);try{if(!bitmap.width||!bitmap.height||bitmap.width>MAX_PHOTO_SIDE||bitmap.height>MAX_PHOTO_SIDE||bitmap.width*bitmap.height>MAX_PHOTO_PIXELS)throw Error('照片最多 16,777,216 像素，单边不超过 8192 像素，请选择较小图片。');}finally{bitmap.close();}if(turn!==photoEpoch||carTurn!==carEpoch)return;photo={file,url:URL.createObjectURL(file),clientId:crypto.randomUUID(),vehicleId:ctx.vehicle.id,stage:null};$('photoImage').src=photo.url;$('photoPreview').hidden=false;text('photoName',file.name);text('photoStatus','照片已就绪，提交时上传到内部记录。');}
 catch(error){if(turn===photoEpoch&&carTurn===carEpoch){formError(error);text('photoStatus','未选择有效照片。');}}
 finally{if(turn===photoEpoch&&carTurn===carEpoch){loadingPhoto=false;controls();}}
}
async function send(event){event.preventDefault();if(busy||loadingPhoto||ctx?.can_submit!==true||!allowedRoles.has(identity?.role))return;$('formError').hidden=true;const authTurn=epoch,carTurn=carEpoch;const current=()=>authTurn===epoch&&carTurn===carEpoch;busy=true;controls();
 try{
  if(!pending){const d=draft();inspectDraft(ctx,d);if(!photo||photo.vehicleId!==ctx.vehicle.id)throw Error('请选择属于当前车辆的仪表照片。');text('photoStatus','正在上传并校验内部照片…');if(!photo.stage){photo.stage=await api.prepare(ctx.vehicle.id,ctx.vehicle.updated_at,photo);if(!current())return;}
   if(!photo.ready){let uploadError;try{await api.upload(photo.stage.path,photo.file);}catch(error){uploadError=error;}if(!current())return;try{await api.verify(photo.stage.id);}catch(error){if(uploadError){const failure=Error('照片上传未确认：'+(uploadError.message||'上传连接失败')+'；校验也未完成：'+(error.message||'请重试。'));failure.uploadError=uploadError;failure.verifyError=error;if(uploadError.code)failure.code=uploadError.code;throw failure;}throw error;}if(!current())return;photo.ready=true;}
   pending={target:ctx.vehicle.id,upload:photo.stage.id,client_submission_id:crypto.randomUUID(),expected_version:ctx.vehicle.updated_at,expected_latest_check:ctx.latest_check_id,reading_text:d.reading,reading_unit:d.unit,checked_at:new Date(d.time).toISOString(),remarks:d.note,vehicle_checked:d.vehicleChecked,unit_checked:d.unitChecked};controls();
  }
  const result=await api.submit(pending);if(!current())return;pending=null;clearPhoto();$('mileageForm').reset();$('checkedAt').value=localDateTime();text('announcement',result.result==='applied'?'已保存检查记录并更新里程。车辆发布状态保持不变。':'已保存异常记录；仅留历史，没有覆盖现有里程。');await loadVehicle();
 }catch(error){if(!current())return;if(error.code==='42501'){clearPrivate();message('库存权限已变化，请重新登录检查。',true);return;}if(pending&&['P0001','42501','23505','22003','22007','22P02'].includes(error.code))pending=null;formError(pending?Error('提交结果尚未确认。请重试同一提交；系统不会重复记录。'):error);}
 finally{if(authTurn===epoch){busy=false;controls();}}
}
async function viewPhoto(row){const authTurn=epoch,carTurn=carEpoch;closePhoto();const dialogTurn=dialogEpoch;$('photoDialog').showModal();text('dialogState','正在读取内部照片…');try{await api.context(row.vehicle_id);const blob=await api.photo(row.photo_path);if(authTurn!==epoch||carTurn!==carEpoch||dialogTurn!==dialogEpoch||!$('photoDialog').open)return;if(blob.size>MAX_PHOTO_BYTES)throw Error('照片超出大小限制。');historyURL=URL.createObjectURL(blob);$('historyPhoto').src=historyURL;$('historyPhoto').hidden=false;text('dialogState',`${row.plate_snapshot} · ${row.actor_name}`);}catch(error){if(authTurn===epoch&&carTurn===carEpoch&&dialogTurn===dialogEpoch)text('dialogState',()=>errorText(error)||t('照片不可用。'));}}
$('photoDialog').addEventListener('close',()=>{if(historyURL)URL.revokeObjectURL(historyURL);historyURL=null;$('historyPhoto').removeAttribute('src');$('historyPhoto').hidden=true;});
$('vehicle').addEventListener('change',()=>{text('announcement','');loadVehicle();});$('reload').addEventListener('click',()=>loadVehicle());$('photoInput').addEventListener('change',choosePhoto);$('removePhoto').addEventListener('click',()=>{clearPhoto();controls();});$('mileageForm').addEventListener('submit',send);
for(const id of ['reading','unit','checkedAt'])$(id).addEventListener('input',warn);
$('moreHistory').addEventListener('click',async()=>{if(!ctx||$('moreHistory').disabled)return;$('moreHistory').disabled=true;const authTurn=epoch,carTurn=carEpoch;try{const rows=await api.history(ctx.vehicle.id,history.at(-1)?.record_sequence);if(authTurn!==epoch||carTurn!==carEpoch)return;history.push(...rows);renderHistory();$('moreHistory').hidden=rows.length<25;}catch(error){if(authTurn===epoch&&carTurn===carEpoch)formError(error);}finally{if(authTurn===epoch&&carTurn===carEpoch)$('moreHistory').disabled=busy;}});
if(api&&mileageEnabled())api.onAuth((event)=>{if(['INITIAL_SESSION','TOKEN_REFRESHED'].includes(event))return;clearPrivate();message('员工会话已变化，正在重新检查…');queueMicrotask(boot);});
boot();

