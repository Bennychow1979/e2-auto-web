import {setupRentalNavigation} from './rental-navigation.mjs?v=1';
import {db,configured,check,esc} from './e2-data.js?v=dashboard-1';
import {dashboardView,barWidths} from './dashboard-view.mjs?v=1';
const $=id=>document.getElementById(id);
let epoch=0,activeUser=null;
const time=value=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Kuala_Lumpur',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
function bars(id,labels,values) {
  const widths=barWidths(values);
  $(id).innerHTML=widths?labels.map((label,i)=>'<div class="bar '+(id==='stockBars'&&i>=2||id==='loanBars'&&i===1?'amber':'')+'"><span>'+esc(label)+'</span><span class="track" aria-hidden="true"><span style="width:'+widths[i]+'%"></span></span><strong>'+values[i]+'</strong></div>').join(''):'<p class="unavailable">暂时无法读取，请刷新重试。不会将未读取的数据显示为 0。</p>';
}
function clear() {
  for(const id of ['membersTotal','stockTotal','loansTotal','deliveredTotal'])$(id).textContent='—';
  $('loanBars').replaceChildren();$('stockBars').replaceChildren();$('actions').replaceChildren();$('emptyQueue').hidden=true;
  $('membersNote').textContent='已完成的网站会员档案';$('deliveryNote').textContent='当月 SOLD & DELIVERED 区块';$('stockNote').textContent='缺失或异常日期单独列出，不按建档日期推算。';$('fleetSource').textContent='全车队来源：MASTERLIST · 等待读取';
}
function render(data) {
  const view=dashboardView(data);
  for(const [id,value] of Object.entries({membersTotal:view.members,stockTotal:view.stock,loansTotal:view.loans,deliveredTotal:view.delivered}))$(id).textContent=value;
  $('period').textContent=data.month+' · MYT';
  $('membersNote').textContent=data.members?'已完成的会员档案 · 本月新增 '+data.members.month+' 人':'会员档案暂时无法读取';
  bars('loanBars',['待初审','待补资料','待送审','已送金融机构'],data.loans?.groups);
  bars('stockBars',['0–30 天','31–60 天','61–90 天','超过 90 天'],data.fleet?.ages);
  if(data.fleet){
    $('deliveryNote').textContent='当月已交车区块 · 另有 '+data.fleet.pending+' 辆待交';
    $('stockNote').textContent='全车队当前库存区，含整备及已订；'+data.fleet.missingDates+' 辆日期缺失或异常，未计入天数分组。';
    $('fleetSource').textContent='全车队来源：MASTERLIST / '+data.fleet.sheet+' · 源文件更新：'+time(data.fleet.sourceModifiedAt)+' MYT';
  }else $('fleetSource').textContent='MASTERLIST 暂时无法核实：请检查当月工作表、重复车牌及来源连接后重试。';
  $('actions').innerHTML=view.actions.map(a=>'<tr><td><span class="priority '+a.tone+'">'+a.priority+'</span></td><td>'+esc(a.item)+'</td><td>'+esc(a.next)+'</td><td><a href="'+esc(a.href)+'"'+(a.href.startsWith('https:')?' target="_blank" rel="noopener noreferrer"':'')+'>'+esc(a.label)+' ↗</a></td></tr>').join('');
  $('emptyQueue').hidden=view.actions.length>0||data.errors.length>0;
  $('loadStatus').classList.toggle('error',data.errors.length>0);
  $('loadStatus').textContent=data.errors.length?'部分数据未能读取，相关数字已留空。请刷新重试。':'已读取最新数据 · '+time(data.asOf)+' MYT';
}
async function refresh() {
  if(!activeUser)return;
  const token=++epoch;clear();$('refresh').disabled=true;$('loadStatus').textContent='正在核对最新数据…';
  try {
    // Both the UI and the endpoint check active Super Admin membership.
    if(check(await db.rpc('e2_is_super_admin'))!==true)throw Error('Access denied');
    const response=await db.functions.invoke('e2-management-dashboard',{body:{}});
    if(token!==epoch)return;
    const data=check(response);if(!data?.asOf||!Array.isArray(data.errors))throw Error('Invalid response');render(data);
  }catch{if(token===epoch){clear();$('loadStatus').classList.add('error');$('loadStatus').textContent='总览暂时无法读取。请刷新重试；如权限已变更，请重新登录。';}}
  finally{if(token===epoch)$('refresh').disabled=false;}
}
async function sessionChanged(session) {
  const token=++epoch;activeUser=null;clear();$('dashboard').hidden=true;$('access').hidden=false;
  if(!session){$('accessMessage').textContent='请使用 Super Admin 员工账号登录。';return}
  try{
    const allowed=check(await db.rpc('e2_is_super_admin'));if(token!==epoch)return;
    if(allowed!==true){$('accessMessage').textContent='此总览仅供已启用的 Super Admin 使用。';return}
    activeUser=session.user.id;$('access').hidden=true;$('dashboard').hidden=false;await refresh();
  }catch{if(token===epoch)$('accessMessage').textContent='暂时无法验证权限，请重新登录。';}
}
$('refresh').onclick=refresh;
$('menu').onclick=()=>{const open=$('navigation').classList.toggle('open');$('menu').setAttribute('aria-expanded',String(open))};
document.addEventListener('keydown',event=>{if(event.key==='Escape'){$('navigation').classList.remove('open');$('menu').setAttribute('aria-expanded','false')}});
$('signOut').onclick=async()=>{++epoch;activeUser=null;clear();$('dashboard').hidden=true;$('access').hidden=false;try{check(await db.auth.signOut());location.replace('portal.html')}catch{$('accessMessage').textContent='退出未完成，请检查连接后重新登录。'}};
if(!configured)$('accessMessage').textContent='数据库连接尚未配置。';
else db.auth.onAuthStateChange((event,session)=>{
  if(event==='PASSWORD_RECOVERY'){location.replace('portal.html'+location.hash);return}
  if(event==='SIGNED_OUT'){++epoch;activeUser=null;clear();$('dashboard').hidden=true;$('access').hidden=false;$('accessMessage').textContent='已退出登录。';return}
  if(event==='INITIAL_SESSION'||(event==='SIGNED_IN'&&session?.user.id!==activeUser))setTimeout(()=>sessionChanged(session),0);
});

if(db)setupRentalNavigation(db);
