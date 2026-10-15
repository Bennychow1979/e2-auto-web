export const MAX_PHOTO_BYTES=5*1024*1024;
export const MAX_PHOTO_SIDE=8192;
export const MAX_PHOTO_PIXELS=16*1024*1024;
export const mileageEnabled=()=>globalThis.E2_CONFIG?.mileageChecks===true;
export function normalizeMileage(value,unit){
 if(!/^[0-9]{1,10}$/.test(String(value))||!['km','mile'].includes(unit))throw Error('请输入非负整数，并选择 km 或 mile。');
 const reading=Number(value),km=Math.round(reading*(unit==='mile'?1.609344:1));
 if(!Number.isSafeInteger(reading)||km>2147483647)throw Error('读数超出可保存范围。');
 return {reading,km};
}
export function inspectDraft(ctx,draft,now=Date.now()){
 const {reading,km}=normalizeMileage(draft.reading,draft.unit),when=Date.parse(draft.time);
 if(!Number.isFinite(when)||when>now+60000)throw Error('请选择有效的检查时间，不能填写未来时间。');
 if(!draft.vehicleChecked)throw Error('请核对车辆、车牌与照片后勾选确认。');
 if((draft.note||'').length>1000)throw Error('备注最多 1000 字。');
 const unitChanged=draft.unit!==(ctx.last_applied_unit||'km');
 if(unitChanged&&(!draft.unitChecked||!draft.note?.trim()))throw Error('单位变化时，请勾选已核对单位并填写说明。');
 const reasons=[];
 if(ctx.vehicle.mileage!==null&&km<ctx.vehicle.mileage)reasons.push('读数低于车辆现有记录');
 if(ctx.last_applied_at&&when<Date.parse(ctx.last_applied_at))reasons.push('检查时间早于最近已带入的记录');
 return {reading,km,reasons,unitChanged};
}
export function localDateTime(date=new Date()){return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}
export const reasonText=reason=>({decreasing_reading:'读数低于现有记录',older_inspection:'检查时间较旧'}[reason]||'仅留历史，未回填');
