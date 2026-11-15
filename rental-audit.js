import {db,configured,check} from './e2-data.js?v=rental-audit-1';
import {changes,fieldLabel,valueLabel,actorLabel,timeLabel,kindLabel} from './rental-audit-view.mjs?v=1';
const $=s=>document.querySelector(s);
let epoch=0,request=0,currentUser=null,cursors=[null],page=0,filter='',busy=false,detailRequest=0;
function node(tag,text,className){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;}
function clearDetail(){detailRequest++;$('#detail').close();$('#changes').replaceChildren();$('#detailMeta').textContent='';$('#detailTitle').textContent='修改前后';}
function gate(message){epoch++;request++;currentUser=null;busy=false;cursors=[null];page=0;filter='';$('#plate').value='';$('#records').replaceChildren();clearDetail();$('#content').hidden=true;$('#signOut').hidden=true;$('#returnDashboard').hidden=true;$('#gate').hidden=false;$('#gateMessage').textContent=message;$('#status').textContent='';}
async function permitted(){if(check(await db.rpc('e2_is_super_admin'))!==true)throw Error('denied');}
async function load(reset=false){
 if(busy)return;if(reset){page=0;cursors=[null];filter=$('#plate').value.trim();}
 const token=epoch,serial=++request;busy=true;$('#previous').disabled=true;$('#next').disabled=true;$('#records').replaceChildren();clearDetail();$('#status').textContent='正在读取…';
 try{
  const rows=check(await db.rpc('rental_audit_list',{p_before:cursors[page],p_plate:filter,p_limit:20}));
  if(token!==epoch||serial!==request)return;
  for(const row of rows){
   const card=node('article',undefined,'record'),head=node('div',undefined,'recordHead');head.append(node('div',kindLabel(row.kind),'kind'));
   const open=node('button','查看前后对比');open.addEventListener('click',()=>detail(row));head.append(open);card.append(head);
   card.append(node('h2',row.plate||(row.tbl==='rental_access'?'员工授权':'租车设置')));
   const meta=node('div',undefined,'meta');for(const [label,text] of [['操作人',actorLabel(row)],['时间',timeLabel(row.at)]]){const item=node('div');item.append(node('span',label),node('div',text));meta.append(item);}card.append(meta,node('p','记录 #'+row.id+' · '+row.action+' · '+row.row_id));$('#records').append(card);
  }
  $('#status').textContent=rows.length?'第 '+(page+1)+' 页 · '+rows.length+' 条记录':'没有符合条件的记录。';
  cursors[page+1]=rows.at(-1)?.id;$('#previous').disabled=page===0;$('#next').disabled=rows.length<20;
 }catch{if(token===epoch)gate('无法读取操作记录。请确认已登录 Super Admin 后重试。');}
 finally{if(token===epoch)busy=false;}
}
async function detail(row){
 const token=epoch,serial=++detailRequest;$('#changes').replaceChildren(node('p','正在读取…'));$('#detailTitle').textContent=(row.plate||kindLabel(row.kind))+' · 修改前后';$('#detailMeta').textContent=actorLabel(row)+' · '+timeLabel(row.at)+' · #'+row.id;$('#detail').showModal();
 try{
  const data=check(await db.rpc('rental_audit_detail',{p_id:row.id}));if(token!==epoch||serial!==detailRequest)return;
  $('#changes').replaceChildren();const diff=changes(data.before,data.after);
  for(const change of diff){const box=node('section',undefined,'diff');box.append(node('h3',fieldLabel(change.path)||'资料'));const values=node('div',undefined,'values');for(const [label,value] of [['修改前',change.before],['修改后',change.after]]){const column=node('div',undefined,'value');column.append(node('b',label),node('pre',valueLabel(value)));values.append(column);}box.append(values);$('#changes').append(box);}
  if(!diff.length)$('#changes').append(node('p','业务资料没有变化（可能只更新了记录版本）。'));
 }catch{if(token===epoch&&serial===detailRequest)gate('无法读取该记录。请重新验证 Super Admin 权限。');}
}
async function boot(session){gate('正在验证 Super Admin 权限…');if(!session){gate('请先使用 Super Admin 员工账号登录。');return;}const token=epoch;
 try{const user=check(await db.auth.getUser()).user;await permitted();if(token!==epoch)return;currentUser=user.id;$('#gate').hidden=true;$('#content').hidden=false;$('#signOut').hidden=false;$('#returnDashboard').hidden=false;await load(true);}catch{if(token===epoch)gate('仅 Super Admin 可以查看操作记录。');}
}
$('#filters').addEventListener('submit',e=>{e.preventDefault();void load(true);});$('#refresh').onclick=()=>load(true);
$('#previous').onclick=()=>{if(!busy&&page>0){page--;void load();}};$('#next').onclick=()=>{if(!busy&&cursors[page+1]){page++;void load();}};
$('#closeDetail').onclick=clearDetail;$('#detail').addEventListener('cancel',e=>{e.preventDefault();clearDetail();});
$('#signOut').onclick=async()=>{gate('正在退出…');try{check(await db.auth.signOut());gate('已退出。');}catch{gate('退出未完成，请回员工入口重试。');}};
let verifying=false;
async function recheck(){if(!currentUser||verifying)return;verifying=true;const token=epoch;try{await permitted();}catch{if(token===epoch)gate('Super Admin 权限已失效或连接失败，请重新登录。');}finally{verifying=false;}}
if(!configured)gate('系统连接未配置。');else{
 db.auth.onAuthStateChange((event,session)=>{if(event==='PASSWORD_RECOVERY'){location.replace('portal.html'+location.hash);return;}if(event==='SIGNED_OUT'){gate('已退出。');return;}if(event==='INITIAL_SESSION'||(event==='SIGNED_IN'&&session?.user.id!==currentUser))setTimeout(()=>boot(session),0);});
 setInterval(recheck,15000);window.addEventListener('focus',recheck);
}
