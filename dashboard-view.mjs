const integer=value=>Number.isSafeInteger(value)&&value>=0;
const number=value=>integer(value)?value.toLocaleString('en-MY'):'—';
export function dashboardView(data) {
  const fleet=data?.fleet,loans=data?.loans,members=data?.members,commissions=data?.commissions;
  const actions=[];
  if(loans?.needsInformation?.loan)actions.push({priority:'今天优先',tone:'red',item:number(loans.needsInformation.loan)+' 宗网站贷款待补资料',next:'补齐资料后再送审',href:'loans.html',label:'网站贷款'});
  if(loans?.needsInformation?.intake)actions.push({priority:'今天优先',tone:'red',item:number(loans.needsInformation.intake)+' 宗销售收件待补资料',next:'补齐资料后再送审',href:'intake-workspace.html',label:'销售贷款收件'});
  if(fleet?.ages?.[3])actions.push({priority:'库存预警',tone:'amber',item:number(fleet.ages[3])+' 辆在库超过 90 天',next:'核对车况及售价',href:'https://docs.google.com/spreadsheets/d/1J6chzBi0limhdzc0wGtS9HX1lzxjYdS8/edit',label:'MASTERLIST'});
  if(fleet?.missingDates)actions.push({priority:'待核对',tone:'amber',item:number(fleet.missingDates)+' 辆入库日期待核对',next:'补齐实际 DATE IN 或修正异常日期',href:'https://docs.google.com/spreadsheets/d/1J6chzBi0limhdzc0wGtS9HX1lzxjYdS8/edit',label:'MASTERLIST'});
  if(fleet?.pending)actions.push({priority:'待处理',tone:'',item:number(fleet.pending)+' 辆待交车',next:'确认放款及交车安排',href:'https://docs.google.com/spreadsheets/d/1J6chzBi0limhdzc0wGtS9HX1lzxjYdS8/edit',label:'MASTERLIST'});
  if(commissions?.pending)actions.push({priority:'待审核',tone:'',item:number(commissions.pending)+' 宗佣金待审核',next:'核对推荐记录及成交条件',href:'referrals.html',label:'推荐与佣金'});
  return {members:number(members?.total),stock:number(fleet?.stock),loans:number(loans?.active),delivered:number(fleet?.delivered),actions};
}
export function barWidths(values) {
  if(!Array.isArray(values)||!values.every(integer))return null;
  const max=Math.max(1,...values);return values.map(v=>100*v/max);
}
