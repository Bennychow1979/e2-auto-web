const labels={plate:'车牌',brand:'品牌',model:'车款',year:'年份',owner_name:'车主姓名',owner_phone:'车主电话',agent:'代理',financier:'贷款机构',bank:'银行',account_no:'账户号码',loan_amount:'贷款金额',monthly:'月供',tenure:'期数',first_payment_date:'首期付款日',paid_count_excel:'导入时已付期数',payments:'付款记录',paid_date:'付款日期',amount:'金额',method:'付款方式',seq:'期数',note:'备注',by:'记录中的操作者',at:'记录时间',handovers:'交接记录',type:'类型',date:'日期',to:'接收方',phone:'电话',partner:'租客来源',rent:'租金',how:'收回方式',void:'已作废',void_reason:'作废原因',status:'状态',car_status:'车辆状态',branch:'分行',deliver_date:'交车日期',target_price:'目标首付',actual_rent:'实际首付',adv_installment:'ADV 金额',adv_status:'ADV 状态',gps:'GPS',spare_key:'备用钥匙',notes:'备注',check_note:'待核实事项',history:'历史记录',enabled:'已授权',user_id:'员工账号 ID',agents:'代理列表',financiers:'贷款机构列表',partners:'租客来源列表',code:'代码',name:'名称',updated_by:'操作账号',updated_at:'更新时间',revision:'版本'};
export const kindLabel=k=>({access:'授权变更',settings:'租车设置',vehicle_added:'新增车辆',vehicle_deleted:'删除车辆',payment:'付款记录变更',handover:'交接记录变更',vehicle_updated:'车辆资料修改'}[k]||'资料变更');
export const actorLabel=r=>r.actor_email||(r.actor?'已删除或无法识别的账号 · '+r.actor:'系统／导入（无员工账号）');
export const timeLabel=v=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(v))+' MYT';
export function fieldLabel(path){return path.map(k=>typeof k==='number'?'第 '+(k+1)+' 项':(Object.hasOwn(labels,k)?labels[k]+' ('+k+')':k)).join(' › ');}
export function valueLabel(value){if(value===undefined)return '未设置';if(value===null)return '空值 (null)';if(value==='')return '空白文字';if(typeof value==='boolean')return value?'是 (true)':'否 (false)';return typeof value==='object'?JSON.stringify(value,null,2):String(value);}
export function changes(before,after,path=[]){
 if(Object.is(before,after))return [];
 const object=v=>v!==null&&typeof v==='object';
 if(object(before)&&object(after)&&Array.isArray(before)===Array.isArray(after)){
  const keys=Array.isArray(before)?Array.from({length:Math.max(before.length,after.length)},(_,i)=>i):[...new Set([...Object.keys(before),...Object.keys(after)])].sort();
  return keys.flatMap(k=>changes(Object.hasOwn(before,k)?before[k]:undefined,Object.hasOwn(after,k)?after[k]:undefined,[...path,k]));
 }
 // Expand added/removed objects so a new payment's date, amount and method are readable.
 if((before===undefined||before===null)&&object(after)&&Object.keys(after).length)return Object.keys(after).flatMap(k=>changes(undefined,after[k],[...path,Array.isArray(after)?Number(k):k]));
 if((after===undefined||after===null)&&object(before)&&Object.keys(before).length)return Object.keys(before).flatMap(k=>changes(before[k],undefined,[...path,Array.isArray(before)?Number(k):k]));
 return [{path,before,after}];
}
