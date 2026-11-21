import {db as sb,configured,check} from './e2-data.js?v=rental-1';
import {createRentalStore} from './rental-data.mjs?v=move-plate-2';
import {loadRentalStock,plateKey,rentalStockMatches,rentalStockDetails} from './rental-stock.mjs?v=1';
let authEpoch=0,currentUser=null;
async function authorized(){
 const token=authEpoch;
 let identity;
 try{if(!configured)throw Error('Not configured');identity=check(await sb.rpc('rental_identity'));}
 catch(error){if(token===authEpoch)gate('未获租车模块权限，请联系 Super Admin。 Rental access has not been granted.');throw error;}
 if(token!==authEpoch||!identity?.user_id||(currentUser&&identity.user_id!==currentUser))throw Error('Rental session changed');
 if(me){me.name=identity.display_name;$('#who').textContent=me.name;}
 return identity;
}
const rentalServices={async use(cap){if(cap==='downloads')return {async save({filename,data}){await authorized();const url=URL.createObjectURL(new Blob([data],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}};return null;}};
function gate(message='请用已获授权的员工账号登录。'){
 ++authEpoch;unsub?.();unsub=null;currentUser=null;me=null;writable=false;rows=[];selected.clear();
 settings={agents:[],financiers:[],partners:[]};settingsRevision=0;fins=[];db=null;
 $('#app').hidden=true;$('#hdr').hidden=true;$('#login').hidden=false;$('#btnAccess').hidden=true;$('#auditLink').hidden=true;$('#returnDashboard').hidden=true;
 $('#stats').replaceChildren();$('#rows').replaceChildren();$('#panel').replaceChildren();$('#drawer').classList.remove('open');
 $('#who').textContent='';$('#fQ').value='';$('#fPartner').innerHTML='<option value="">全部租客来源 / All sources</option>';$('#rentalStatus').textContent='';$('#toast').textContent='';$('#toast').classList.remove('show');$('#selCount').textContent='';$('#selbar').hidden=true;
 window.__openId=null;window.__editingId=null;window.__dirty=false;window.__pendingOpen=null;resetPanel();
 $('#loginErr').textContent=message;
}



const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = n => n == null ? '' : 'RM' + Number(n).toLocaleString('en-MY', {maximumFractionDigits: 0});
const fd = s => s ? s.slice(8,10) + '/' + s.slice(5,7) + '/' + s.slice(0,4) : '—';
const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kuala_Lumpur',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const UP = v => (typeof v === 'string' ? v.toUpperCase() : v);
const STATUS_CN = {OVERDUE:'逾期 Overdue', URGENT:'3 天内 Due soon', SOON:'7 天内 Due soon', UPCOMING:'14 天内 Upcoming', OK:'正常 OK', CLOSED:'已结束 Closed', PENDING:'待放款 Pending disbursement'};
const METHODS = ['CDM','PAY BILL','TRANSFER','DISB DEDUCT','JOMPAY','CASH','OTHER'];
const AGENTS = [];
const FINS = [];
let fins = FINS, rows = [], me = null, db = null, writable = true, unsub = null;
const selected = new Set();
// Drafts live only in this panel; never persist customer input across sign-out.
let panelVersion=0,panelKind='',discardArmed=false,panelRecord=null;
const panelDrafts=new Map();
function resetPanel(kind=''){
  panelVersion++;panelKind=kind;panelRecord=null;panelDrafts.clear();discardArmed=false;window.__dirty=false;
  window.__openId=null;window.__editingId=null;
}
const fieldValue=el=>el.type==='checkbox'?el.checked:el.value;
function trackDraft(event){
  const el=event.target;
  if(!el.matches('input,select,textarea')||el.readOnly||!el.id||el.hasAttribute('data-no-draft'))return;
  panelDrafts.set(el.id,fieldValue(el));window.__dirty=true;discardArmed=false;
}
$('#panel').addEventListener('input',trackDraft);
$('#panel').addEventListener('change',trackDraft);
function canRefreshDetail(){
  return panelKind==='detail'&&!window.__dirty&&!panelDrafts.size&&
    !$('#panel').contains(document.activeElement);
}
async function saveDetail(r,data,action,prefix){
  const token=authEpoch,version=panelVersion,sent=new Map(panelDrafts);
  const saved=await db.collection('contracts').doc(r.id).update({...data,history:stamp(r,action)},r._rental_revision);
  if(token!==authEpoch||version!==panelVersion)return false;
  const updated={id:r.id,...derive(saved.data())};
  rows=rows.map(row=>row.id===r.id?updated:row);sortRows();render();
  // Only discard fields included in this successful save. Other sections and
  // text entered while the request was pending remain drafts.
  const remaining=new Map([...panelDrafts].filter(([id,value])=>!id.startsWith(prefix)||sent.get(id)!==value));
  const focused=document.activeElement?.id;
  await openDetail(r.id);
  if(token!==authEpoch)return;
  for(const [id,value] of remaining){
    if(id.startsWith('vr_')&&!document.getElementById(id))askVoid(r.id,Number(id.slice(3)));
    if(id.startsWith('eh_')&&!document.getElementById(id))askEditHand(r.id,Number(id.split('_')[1]));
    const el=document.getElementById(id);if(!el)continue;
    if(el.type==='checkbox')el.checked=value;else el.value=value;
    panelDrafts.set(id,value);
  }
  window.__dirty=panelDrafts.size>0;
  if([...panelDrafts.keys()].some(id=>id.startsWith('x_'))&&$('#btnExtras')){
    $('#btnExtras').classList.add('primary');$('#btnExtras').textContent='💾 保存 Save — 有改动未保存 unsaved';
  }
  if(focused)document.getElementById(focused)?.focus();
  return true;
}

function selBar(){ $('#selbar').hidden = selected.size === 0; $('#selCount').textContent = `已选 ${selected.size} 台 / ${selected.size} selected`; }
$('#btnSelWA').onclick = () => copyWA([...selected]);
$('#btnSelClear').onclick = () => { selected.clear(); render(); };
$('#selAll').onchange = e => { filtered().forEach(r => e.target.checked ? selected.add(r.id) : selected.delete(r.id)); render(); };

function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>t.classList.remove('show'),3000);}
const canEdit = () => !!me && writable;

/* ---------- derived fields (computed on every snapshot) ---------- */
function addMonths(iso,n){ const d=new Date(iso+'T00:00:00Z'),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+n);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));return d.toISOString().slice(0,10); }
function derive(c){
  const r = {...c};
  const pays = Array.isArray(c.payments) ? c.payments : [];
  r.payments = pays;
  r.handovers = (Array.isArray(c.handovers) ? c.handovers : []).map(h => h.type ? h : { ...h, type: /REPO|RETURN|BTC|STOCK|SHOWROOM|BACK/.test(((h.to||'')+' '+(h.note||'')).toUpperCase()) ? 'IN' : 'OUT' });
  const live = r.handovers.filter(h => !h.void);
  const lastH = live[live.length - 1];
  r.rented = !!lastH && lastH.type === 'OUT';
  r.holder = r.rented ? lastH.to : (lastH ? (lastH.how||'拉回') + (lastH.note?' · '+lastH.note:'') : '');
  r.holder_date = lastH ? lastH.date : '';
  r.actual_rent = c.actual_rent ?? (r.rented && lastH.rent ? lastH.rent : null);
  r.partner = r.rented ? (lastH.partner || '') : '';
  r.holder_phone = r.rented ? (lastH.phone || '') : '';
  r.check = !!(c.check_note && String(c.check_note).trim());
  r.adv_status = c.adv_status || (c.adv_collected ? 'COLLECTED' : 'PENDING');
  r.adv_due = Number(c.adv_installment) > 0 && r.adv_status === 'PENDING';
  r.adv_lost = Number(c.adv_installment) > 0 && r.adv_status === 'LOST';
  r.paid_count = (Number(c.paid_count_excel)||0) + pays.length;
  const f = fins.find(x => x.code === c.financier);
  const acc = (c.account_no||'').replace(/\D/g,'');
  r.pay_bank = f ? ((f.alt && acc.length === f.alt.acct_digits) ? f.alt.bank : f.bank) : (c.bank || '');
  r.pay_to = c.financier === 'PBB' ? (c.account_no||'') + '90010' : (c.account_no||'');
  if (c.first_payment_date) {
    r.next_due = addMonths(c.first_payment_date, r.paid_count);
    const t = new Date(today()+'T00:00:00'), nd = new Date(r.next_due+'T00:00:00');
    r.days_left = Math.round((nd - t) / 86400000);
    const fp = new Date(c.first_payment_date+'T00:00:00');
    const monthsDue = t < fp ? 0 : (t.getFullYear()-fp.getFullYear())*12 + (t.getMonth()-fp.getMonth()) + (t.getDate() >= fp.getDate() ? 1 : 0);
    r.od_amount_est = Math.max(0, monthsDue - r.paid_count) * (Number(c.monthly)||0);
  } else { r.next_due = null; r.days_left = null; r.od_amount_est = 0; }
  r.moved = c.car_status === 'MOVED';
  const closed = ['RETURNED','OWNER TAKE BACK','REDEEM','AUCTIONED','LOST'].includes(c.car_status);
  // Loan approved but not yet disbursed: account no / first payment date unknown, car can be listed (pre-booking) but not handed over.
  r.pending = c.pending_disbursement === true;
  // Pre-booking: a renter reserved the car (deposit paid) before handover; converted to a rent-out later.
  r.booking = c.booking && typeof c.booking === 'object' && !Array.isArray(c.booking) ? c.booking : null;
  r.status = closed ? 'CLOSED' : r.pending ? 'PENDING' : r.days_left == null ? 'OK' : r.days_left < 0 ? 'OVERDUE' : r.days_left <= 3 ? 'URGENT' : r.days_left <= 7 ? 'SOON' : r.days_left <= 14 ? 'UPCOMING' : 'OK';
  return r;
}

/* ---------- staff authentication and explicit rental permission ---------- */
$('#rentalLogin').onsubmit=async e=>{
 e.preventDefault();$('#btnIn').disabled=true;$('#loginErr').textContent='正在登录 Signing in…';
 try{check(await sb.auth.signInWithPassword({email:$('#rentalEmail').value.trim(),password:$('#rentalPassword').value}));$('#rentalPassword').value='';}
 catch{$('#loginErr').textContent='登录失败，请检查账号和密码。 Sign-in failed.';}
 finally{$('#btnIn').disabled=false;}
};
$('#btnOut').onclick=async()=>{gate('正在退出…');try{check(await sb.auth.signOut());gate('已退出 Signed out.');}catch{$('#loginErr').textContent='退出未完成，请重试。';}};
async function boot(session){
 gate();if(!session)return;const token=authEpoch;
 try{
  const user=check(await sb.auth.getUser()).user;const identity=await authorized();if(token!==authEpoch)return;
  if(identity.user_id!==user.id)throw Error('Rental session changed');
  me={id:user.id,name:identity.display_name||user.email};currentUser=user.id;writable=true;
  const isSuper=check(await sb.rpc('e2_is_super_admin'));if(token!==authEpoch)return;
  db=createRentalStore(sb,authorized);
  $('#login').hidden=true;$('#app').hidden=false;$('#hdr').hidden=false;$('#who').textContent=me.name;
  $('#btnAccess').hidden=isSuper!==true;$('#auditLink').hidden=isSuper!==true;$('#returnDashboard').hidden=isSuper!==true;
  unsub=db.collection('contracts').onSnapshot(async snap=>{
   const sd=await db.doc('settings/lists').get();if(token!==authEpoch)return;
   if(!sd.exists)throw Error('Rental settings unavailable');
   const d=sd.data();settings={agents:d.agents||[],financiers:d.financiers||[],partners:d.partners||[]};settingsRevision=d._rental_revision;fins=allFins();
   rows=snap.docs.filter(d=>d.exists).map(d=>({id:d.id,...derive(d.data())})).filter(r=>!r.moved);sortRows();
   if(window.__pendingOpen&&rows.some(r=>r.id===window.__pendingOpen)){const id=window.__pendingOpen;window.__pendingOpen=null;setTimeout(()=>{if(me&&!$('#drawer').classList.contains('open'))openDetail(id);},0);}
   const cur=$('#fPartner').value;
   $('#fPartner').innerHTML='<option value="">全部租客来源 / All sources</option><option value="DIRECT">直接租客 Direct</option>'+allPartners().map(a=>'<option value="'+esc(a)+'">'+esc(a)+'</option>').join('');
   $('#fPartner').value=cur;render();
   $('#rentalStatus').textContent='已读取 '+rows.length+' 台 · '+new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Kuala_Lumpur',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date())+' MYT';
   if($('#drawer').classList.contains('open')&&window.__openId&&canRefreshDetail())openDetail(window.__openId,true);
  },()=>{if(token===authEpoch)gate('无法读取租车资料或权限已撤销，请重新登录。');});
 }catch{if(token===authEpoch)gate('无法验证租车权限，请联系 Super Admin 或重试。');}
}


async function load(){ /* live via onSnapshot */ }
['fStatus','fPartner','fQ','fSort'].forEach(id => $('#'+id).addEventListener('input', render));
$('#btnRefresh').onclick = () => unsub?.refresh();
$('#btnExport').onclick = async () => {
  const dl = await rentalServices.use('downloads');
  if (!dl) { toast('这个环境不支持下载 Download not available here'); return; }
  const list = filtered();
  const cols = [['plate','车牌 Plate'],['brand','Brand'],['model','Model'],['year','Year'],['car_status','车辆状态 Car status'],
    ['rental_state','租出/在库 Rental'],['holder','车在谁手上 Holder'],['holder_phone','租客电话 Renter phone'],['partner','租客来源 Source'],['holder_date','交接日期 Handover date'],['branch','Branch'],
    ['owner_name','车主 Owner'],['owner_phone','电话 Phone'],['agent','Agent'],['financier','Financier'],['pay_bank','付款银行 Bank'],['pay_to','户口 Account'],['pay_reference','Reference'],
    ['loan_amount','贷款额 Loan'],['monthly','月供 Monthly'],['tenure','期数 Tenure'],['first_payment_date','首期日 First pmt'],['due_day','每月几号 Due day'],
    ['paid_count','已付 Paid'],['next_due','下期 Next due'],['days_left','剩余天 Days left'],['status','供款状态 Status'],['od_amount_est','逾期金额 Est. overdue'],
    ['deliver_date','交车日 Delivered'],['target_price','Target upfront'],['actual_rent','实际 upfront Actual'],['adv_installment','ADV instalment'],['adv_status','ADV 状态'],['gps','GPS'],['spare_key','Spare key'],['notes','备注 Notes'],['check_note','待核实 To confirm'],['last_payment','最后付款 Last payment'],['handover_log','交接记录 Handover log'],['booking_txt','预订 Pre-booking']];
  const q = v => { let raw=v==null?'':String(v);if(typeof v==='string'&&/^[\s]*[=+@-]/.test(raw))raw="'"+raw;const t=raw.replace(/"/g,'""');return /[",\r\n]/.test(t)?'"'+t+'"':t; };
  const rowsOut = list.map(r => {
    const x = {...r, rental_state: r.status==='CLOSED'?'CLOSED':(r.rented?'RENTED':'IN STOCK'),
      last_payment: r.payments.length ? r.payments[r.payments.length-1].paid_date : '',
      gps: r.gps?'YES':'', spare_key: r.spare_key?'YES':'',
      booking_txt: r.booking ? `${r.booking.date||''} ${r.booking.to||''}${r.booking.phone?' '+r.booking.phone:''}${r.booking.partner?' ['+r.booking.partner+']':''}${r.booking.deposit?' deposit RM'+r.booking.deposit:''}` : '',
      handover_log: r.handovers.filter(h=>!h.void).map(h => `${h.date||''} ${h.type==='IN'?(h.how||'RETURN'):'OUT'} ${h.to||''}${h.phone?' '+h.phone:''}${h.partner?' ['+h.partner+']':''}${h.rent?' RM'+h.rent:''}${h.note?' ('+h.note+')':''}`).join(' | ')};
    return cols.map(([k]) => q(x[k])).join(',');
  });
  const csv = '\ufeff' + cols.map(([,h]) => q(h)).join(',') + '\n' + rowsOut.join('\n');
  const name = `rental_tracker_${today()}.csv`;
  try { await dl.save({filename: name, data: csv}); toast(`已导出 ${list.length} 台 Exported`); }
  catch (e) { if (e && e.code !== 'declined') toast('导出失败 Export failed: ' + (e.message||e.code)); }
};

function modelMatch(r, q){
  const qn = q.replace(/[^A-Z0-9]/g,''); if (!qn) return false;
  const toks = ((r.brand||'')+' '+(r.model||'')+' '+(r.year||'')).toUpperCase().split(/[\s\/(),]+/).map(t => t.replace(/[^A-Z0-9]/g,'')).filter(Boolean);
  const joined = toks.join(' ');
  if (joined.includes(' '+qn+' ') || joined.startsWith(qn+' ') || joined.endsWith(' '+qn) || joined === qn) return true;
  return toks.some(t => t.startsWith(qn) && /[A-Z]/.test(t.charAt(qn.length)));   // X5 matches X5I/X5M, not X50
}
function sortRows(){
  const m = $('#fSort') ? $('#fSort').value : 'due';
  rows.sort((a,b) => {
    if (m === 'new') return String(b.created_at||'').localeCompare(String(a.created_at||'')) || (b.excel_row||0) - (a.excel_row||0);
    if (m === 'plate') return a.plate.localeCompare(b.plate);
    if (m === 'model') return ((a.brand||'')+' '+(a.model||'')).localeCompare((b.brand||'')+' '+(b.model||'')) || a.plate.localeCompare(b.plate);
    return (a.status==='CLOSED') - (b.status==='CLOSED') || (a.days_left ?? 9999) - (b.days_left ?? 9999);
  });
}
function filtered(){
  sortRows();
  const st = $('#fStatus').value, pa = $('#fPartner').value, q = $('#fQ').value.trim().toUpperCase();
  return rows.filter(r =>
    (st==='all' || (st==='open' && r.status!=='CLOSED') || (st==='rented' && r.status!=='CLOSED' && r.rented) || (st==='instock' && r.status!=='CLOSED' && !r.rented) || (st==='check' && r.check) || (st==='pending' && r.status!=='CLOSED' && r.pending) || (st==='booked' && r.status!=='CLOSED' && r.booking) || (st==='closed' && r.status==='CLOSED') || (st==='adv' && r.adv_due) || (st==='advlost' && r.adv_lost) || (st==='OVERDUE' && r.status==='OVERDUE') || (st==='due7' && ['URGENT','SOON','OVERDUE'].includes(r.status))) &&
    (!pa || (pa==='DIRECT' ? (r.rented && !r.partner) : r.partner===pa)) &&
    (!q || (r.plate||'').includes(q) || (r.owner_name||'').toUpperCase().includes(q) || (r.holder||'').toUpperCase().includes(q) || q.split(/\s+/).every(w => modelMatch(r, w))));
}
function render(){
  const open = rows.filter(r => r.status!=='CLOSED');
  const od = open.filter(r => r.status==='OVERDUE');
  const soon = open.filter(r => ['URGENT','SOON'].includes(r.status));
  const rented = open.filter(r => r.rented);
  $('#stats').innerHTML = `
    <div class="stat"><b>${open.length}</b><span>在供车辆 Active</span></div>
    <div class="stat"><b>${rented.length} / ${open.length - rented.length}</b><span>已租出 / 在库 Rented / In stock</span></div>
    <div class="stat bad"><b>${od.length}</b><span>逾期 Overdue</span></div>
    <div class="stat bad"><b>${money(od.reduce((s,r)=>s+Number(r.od_amount_est||0),0))}</b><span>逾期金额（估）Est. overdue</span></div>
    <div class="stat warn"><b>${soon.length}</b><span>7 天内到期 Due in 7d</span></div>
    ${open.filter(r=>r.pending).length?`<div class="stat warn"><b>${open.filter(r=>r.pending).length}</b><span>⏳ 待放款 Pending disbursement</span></div>`:''}
    ${open.filter(r=>r.booking).length?`<div class="stat warn"><b>${open.filter(r=>r.booking).length}</b><span>📌 已预订 Reserved</span></div>`:''}
    ${rows.filter(r=>r.check).length?`<div class="stat warn"><b>${rows.filter(r=>r.check).length}</b><span>⚠ 待核实 To confirm</span></div>`:''}
    ${rows.filter(r=>r.adv_due).length?`<div class="stat warn"><b>${rows.filter(r=>r.adv_due).length} · ${money(rows.filter(r=>r.adv_due).reduce((s,r)=>s+Number(r.adv_installment),0))}</b><span>💰 ADV 待收 To collect</span></div>`:''}
    ${rows.filter(r=>r.adv_lost).length?`<div class="stat"><b>${rows.filter(r=>r.adv_lost).length} · ${money(rows.filter(r=>r.adv_lost).reduce((s,r)=>s+Number(r.adv_installment),0))}</b><span>💸 ADV 收不回 Written off</span></div>`:''}
    ${allPartners().map(p => { const n = open.filter(r => r.partner === p).length; return n ? `<div class="stat"><b>${n}</b><span>${esc(p)}</span></div>` : ''; }).join('')}`;
  const list = filtered();
  $('#empty').hidden = list.length > 0;
  $('#rows').innerHTML = list.map(r => `<tr class="r" data-id="${esc(r.id)}">
    <td><input type="checkbox" class="sel" data-id="${esc(r.id)}" ${selected.has(r.id)?'checked':''}></td>
    <td><b>${esc(r.plate)}</b>${r.check?' <span class="chip" style="background:var(--warn-bg);color:var(--warn);font-size:11px" title="'+esc(r.check_note)+'">⚠ 待核实</span>':''}<br><span class="hint">${esc([r.brand,r.model,r.year].filter(Boolean).join(' '))}</span>${r.pending?'':'<br><button class="btn wa" data-wa="'+esc(r.id)+'">📋 WhatsApp</button>'}</td>
    <td><span class="chip s-${esc(r.status)}">${STATUS_CN[r.status]||r.status}${r.status==='OVERDUE'?' '+(-r.days_left)+'d':''}</span></td>
    <td>${r.status==='CLOSED' ? '<span class="chip s-CLOSED">已结束 Closed</span>' : r.rented ? '<span class="chip s-OK">已租出 Rented</span>' : r.booking ? '<span class="chip s-PENDING">已预订 Reserved'+(r.pending?' · Pre-booking':'')+'</span>' : r.pending ? '<span class="chip s-PENDING">在库 · Pre-booking</span>' : '<span class="chip s-UPCOMING">在库 In stock</span>'}<br>${r.booking?'📌 '+esc(r.booking.to||'')+(r.booking.phone?' <span class="hint">'+esc(r.booking.phone)+'</span>':'')+(r.booking.partner?' <span class="chip s-UNK" style="font-size:11px">'+esc(r.booking.partner)+'</span>':'')+(r.booking.deposit?' <span class="hint">· deposit '+money(r.booking.deposit)+'</span>':''):esc(r.holder||'—')+(r.holder_phone?' <span class="hint">'+esc(r.holder_phone)+'</span>':'')+(r.partner?' <span class="chip s-UNK" style="font-size:11px">'+esc(r.partner)+'</span>':'')} <span class="hint">${esc(r.holder_date||'')}${r.rented&&r.actual_rent?' · '+money(r.actual_rent):(!r.rented&&r.target_price?' · upfront '+money(r.target_price):'')}${r.gps?' · GPS':''}${r.spare_key?' · 🔑':''}</span>${r.adv_due?'<br><span class="chip" style="background:var(--warn-bg);color:var(--warn);font-size:11px">💰 ADV '+money(r.adv_installment)+' 待收</span>':r.adv_lost?'<br><span class="chip s-CLOSED" style="font-size:11px">💸 ADV '+money(r.adv_installment)+' 收不回</span>':''}</td>
    <td>${r.status==='CLOSED'?'—':fd(r.next_due)}</td>
    <td>${r.paid_count} / ${r.tenure}</td>
    <td>${esc(r.owner_name||'')}<br><span class="hint">${esc(r.owner_phone||'')}</span></td>
    <td>${esc(r.agent||'')}</td><td>${esc(r.financier)}</td><td>${money(r.monthly)}</td>
    <td class="mono">${r.pending&&!r.pay_to?'<span class="hint">待放款 Pending</span>':esc(r.pay_bank)+' '+esc(r.pay_to)+(r.pay_reference?' · Ref '+esc(r.pay_reference):'')}</td>
  </tr>`).join('');
  document.querySelectorAll('tr.r').forEach(tr => tr.onclick = e => { if (e.target.closest('input,button')) return; openDetail(tr.dataset.id); });
  document.querySelectorAll('button.wa').forEach(b => b.onclick = e => { e.stopPropagation(); copyWA([b.dataset.wa]); });
  document.querySelectorAll('input.sel').forEach(cb => cb.onchange = () => { cb.checked ? selected.add(cb.dataset.id) : selected.delete(cb.dataset.id); selBar(); });
  selBar();
}

/* ---------- writes ---------- */
function stamp(c, action){
  const h = Array.isArray(c.history) ? c.history.slice(-29) : [];
  h.push({ at: new Date().toISOString(), by: me.name || me.id || '?', action });
  return h;
}
async function saveContract(v, existing){
  const ref = db.collection('contracts').doc(existing ? existing.id : v.plate.replace(/[^A-Z0-9]/g,'-').replace(/^-+|-+$/g,''));
  if (!existing) {
    const cur = await ref.get();
    if (cur.exists) throw { code: 'dup', message: '这个车牌已经存在' };
    v.payments = []; v.handovers = []; v.paid_count_excel = v.paid_count_excel || 0; v.car_status = 'SOLD'; v.history = stamp({}, v.pending_disbursement ? '新增（待放款）' : '新增');
    if (v.check_note_auto) v.check_note = v.check_note_auto; delete v.check_note_auto;
    v.created_at = new Date().toISOString();
    await ref.set(v);
    return v.plate.replace(/[^A-Z0-9]/g,'-').replace(/^-+|-+$/g,'');
  } else {
    const body = { ...existing }; delete body.id;
    ['paid_count','next_due','days_left','status','od_amount_est','pay_bank','pay_to','handovers_live','holder','holder_date','holder_phone','rented','partner','actual_rent','check','adv_due','adv_lost','adv_status_derived','pending','moved'].forEach(k => delete body[k]);
    body.handovers = existing.handovers; body.actual_rent = existing.actual_rent ?? null;
    // Carry computed fields in v so both ordinary saves and atomic moves receive them.
    if (v.check_note_auto && !body.check_note) v.check_note = v.check_note_auto;
    delete v.check_note_auto;
    if (v.financier === 'CARSOME' && v.jompay_ref2 && /^CARSOME REF-2/i.test(body.check_note||'')) v.check_note = '';
    if (v.plate !== existing.plate) {
      // Plate correction: one RPC moves the record atomically (new id created, old id marked MOVED, or nothing at all).
      const newId = v.plate.replace(/[^A-Z0-9]/g,'-').replace(/^-+|-+$/g,'');
      if (!newId) throw { code: 'plate', message: '车牌不合法 Invalid plate' };
      const patch = { ...v }; delete patch.plate;
      const moved = await db.movePlate(existing.id, newId, v.plate, existing._rental_revision, patch);
      return moved.record.id || newId;
    }
    const wasPending = existing.pending_disbursement === true, nowPending = v.pending_disbursement === true;
    Object.assign(body, v); body.history = stamp(existing, wasPending && !nowPending ? '修改贷款/车主资料（已放款，补齐户口号码/首期日）' : !wasPending && nowPending ? '修改贷款/车主资料（标为待放款）' : '修改贷款/车主资料'); body.updated_at = new Date().toISOString();
    await ref.set(body,existing._rental_revision);
    return existing.id;
  }
}
async function addPayment(r, p){
  if (r.pending) throw Error('待放款不能记录付款 Payments require disbursement');
  const pays = [...r.payments, p];
  await saveDetail(r,{payments:pays},`记录第 ${p.seq} 期付款`,'p_');
}
async function removePayment(r, seq){
  const pays = r.payments.filter(p => p.seq !== seq).map((p,i) => ({...p, seq: (Number(r.paid_count_excel)||0) + i + 1}));
  await db.collection('contracts').doc(r.id).update({ payments: pays, history: stamp(r, `删除第 ${seq} 期付款`) }, r._rental_revision);
}
async function addHandover(r, h){
  const list = [...r.handovers, h];
  await db.collection('contracts').doc(r.id).update({ handovers: list, history: stamp(r, `交接：${h.to}`) }, r._rental_revision);
}
async function editHandover(r, idx, patch){
  const h = r.handovers[idx]; if (!h || h.void) throw { code: 'void', message: '已作废的记录不能改' };
  if (h.deposit != null && (!Number.isFinite(patch.rent) || patch.rent < Number(h.deposit))) throw Error('Total upfront must include the booking deposit');
  const before = {}; Object.keys(patch).forEach(k => { if ((h[k] ?? '') !== (patch[k] ?? '')) before[k] = h[k] ?? ''; });
  if (!Object.keys(before).length) return false;
  const edited = { ...h, ...patch, edited_by: me.name || me.id || '?', edited_at: new Date().toISOString(), edit_log: [...(Array.isArray(h.edit_log) ? h.edit_log : []), { at: new Date().toISOString(), by: me.name || me.id || '?', before }].slice(-10) };
  const list = r.handovers.map((x,i) => i === idx ? edited : x);
  const data = { handovers: list };
  // Only the current (last non-void) rent-out defines the car's current upfront; editing history leaves the summary alone.
  const live = list.filter(x => !x.void);
  if (live[live.length - 1] === edited && edited.type === 'OUT' && 'rent' in patch) data.actual_rent = patch.rent ?? null;
  await patch_(r, data, `修改交接 #${idx+1}: ${Object.keys(before).join(', ')}`, `eh_${idx}_`);
  return true;
}
async function removeHandover(r, idx){
  const list = r.handovers.filter((_,i) => i !== idx);
  await db.collection('contracts').doc(r.id).update({ handovers: list, history: stamp(r, '删除一笔交接记录') }, r._rental_revision);
}

/* ---------- account rules (mirrors rental_financiers; DB trigger re-checks on save) ---------- */
function rule(code){ return fins.find(f => f.code === code); }
function finName(code){ const f = rule(code); return f ? (f.name || f.code) : (code || ''); }
function ruleText(f){
  if (!f) return '';
  const p = [];
  if (f.fixed_account) p.push(`固定户口 ${f.fixed_account}`);
  if (f.acct_digits) p.push(`${f.acct_digits} 位数字`);
  if (f.acct_prefixes?.length) p.push(`开头 ${f.acct_prefixes.join('/')}`);
  if (f.acct_suffix) p.push(`转账时加 ${f.acct_suffix}`);
  if (f.needs_reference) p.push('reference 放车牌');
  if (f.alt && f.alt.only) p.push(`（${f.alt.label} 只限 ${f.alt.only.join(', ')}）`);
  else if (f.alt) p.push(`或 ${f.alt.label}: ${f.alt.acct_digits} 位开头 ${f.alt.acct_prefixes.join('/')}`);
  return `${f.bank}：${p.join('，')}`;
}
function checkAccount(code, acc, plate){
  const f = rule(code); if (!f) return '请选财务公司 Select financier';
  if (code === 'CARSOME') return '';            // validated via ref2 instead
  const d = (acc||'').replace(/\D/g,'');
  if (!d) return '户口号码空白 Account required';
  if (f.alt && f.alt.only && f.alt.only.includes(plate) && d.length === f.alt.acct_digits && f.alt.acct_prefixes.some(p => d.startsWith(p))) return '';
  if (f.alt && d.length === f.alt.acct_digits && f.alt.acct_prefixes.some(p => d.startsWith(p))) return `${code} 现在只用 ${f.bank}，不再接受 ${f.alt.bank} 户口 · ${f.alt.bank} no longer accepted for ${code}`;
  if (f.fixed_account && d !== f.fixed_account) return `${code} 固定户口是 ${f.fixed_account}`;
  if (f.acct_digits && d.length !== f.acct_digits) return `${code} 应为 ${f.acct_digits} 位，现在 ${d.length} 位`;
  if (f.acct_prefixes?.length && !f.acct_prefixes.some(p => d.startsWith(p))) return `${code} 户口开头应是 ${f.acct_prefixes.join('/')}`;
  return '';
}
function payTo(code, acc, plate, ref2){
  const f = rule(code); if (!f) return '';
  const d = (acc||'').replace(/\D/g,'');
  if (code === 'CARSOME') return `JomPAY Biller 82008 · Ref-1 ${plate||'?'} · Ref-2 ${ref2||'?'}`;
  return `${f.bank} ${d}${f.acct_suffix||''}${f.needs_reference ? ' · Reference: ' + (plate||'?') : ''}`;
}

/* ---------- WhatsApp payment details ---------- */
function payLines(r){
  const d = (r.account_no||'').replace(/\D/g,''), plate = r.pay_reference || r.plate;
  switch (r.financier) {
    case 'AEON':      return [`Pay to: AEON CDM, or Maybank / Public Bank Pay Bill → AEON Credit`, `Ref-1 / Account: ${d} (Agreement No)`, `Ref-2: ${plate} (if asked)`];
    case 'PBB':       return [`Pay to: Public Bank`, `Account: ${d}90010`, `*Must include 90010 at the end*`];
    case 'X STAR':    return [`Pay to: UOB Bank — X Star Capital`, `Account: ${d}`, `*Reference MUST be: ${plate}*`];
    case 'CARSOME':   return [`Pay to: JomPAY Biller 82008 (Carsome Capital)`, `Ref-1: ${plate}`, `Ref-2 (Agreement No): ${r.jompay_ref2||'(ask us)'}`];
    case 'CHAILEASE': return [`Pay to: CIMB Bank — Chailease`, `Account: ${d}`];
    case 'GFS':       return [`Pay to: ${d.length === 14 ? 'CIMB Bank' : 'Maybank'} — GFS Technology`, `Account: ${d}`];
    case 'CIMB':      return [`Pay to: CIMB Bank`, `Account: ${d}`];
    case 'AMB':       return [`Pay to: AmBank`, `Account: ${d}`];
    case 'HLB':       return [`Pay to: Hong Leong Bank`, `Account: ${d}`];
    default:          return [`Pay to: ${r.pay_bank||r.financier}`, `Account: ${d}`];
  }
}
function ordinal(n){ const s = ['th','st','nd','rd'], v = n % 100; return n + (s[(v-20)%10] || s[v] || s[0]); }
function carBlock(r, mode){
  const fp = r.first_payment_date;
  const day = fp ? new Date(fp+'T00:00:00').getDate() : (parseInt(r.due_day) || null);
  return [
    `🚗 *${r.plate}* ${[r.brand,r.model,r.year].filter(Boolean).join(' ')}`,
    mode !== 'owner' && r.owner_name ? `Name: ${r.owner_name}` : '',
    `Financier: ${finName(r.financier)}`,
    `Monthly: *${money(r.monthly)}* · ${r.tenure} months`,
    mode === 'owner' && fp ? `First payment: ${fd(fp)}` : '',
    day ? `Due: ${ordinal(day)} of every month` : '',
    ...payLines(r),
  ].filter(l => l !== '').join('\n');
}
const paymentEligible = r => !r.pending;
function waMsg(list, mode){
  list = (list || []).filter(paymentEligible);
  if (!list || !list.length) return '';
  const owner = mode === 'owner' ? (list[0].owner_name || '') : '';
  return [
    `*Payment Details*`,
    owner ? `Name: ${owner}` : '',
    '',
    list.map(r => carBlock(r, mode)).join('\n\n'),
    '',
    mode === 'owner' ? `Thank you.` : `Please send us the receipt after each payment. Thank you.`,
  ].filter((l,i,a) => !(l === '' && (a[i-1] === '' || i === 1))).join('\n');
}
function copyWA(ids, mode){
  const all = ids.map(id => rows.find(r => r.id === id)).filter(Boolean);
  const list = all.filter(paymentEligible);
  if (all.length && !list.length) { toast('待放款的车还没有户口号码，不能发付款资料 Pending disbursement — no payment details yet'); return; }
  if (!list.length) { toast('没有选到车 No car selected'); return; }
  if (list.length < all.length) toast(`已跳过 ${all.length - list.length} 台待放款的车 Skipped pending cars`);
  const text = waMsg(list, mode);
  const ok = () => toast(`已复制 ${list.length} 台车的 WhatsApp 信息`);
  const fallback = () => {
    resetPanel('copy');
    $('#panel').innerHTML = `<h2>复制这段文字<button class="x" onclick="closeDrawer()">×</button></h2>
      <p class="hint">这部手机不允许自动复制。长按下面文字 → 全选 → 复制，再贴到 WhatsApp。</p>
      <textarea id="waText" style="width:100%;min-height:60vh;font:13px/1.5 inherit" readonly>${esc(text)}</textarea>
      <button class="btn primary" style="margin-top:8px" onclick="const t=$('#waText');t.focus();t.select();try{document.execCommand('copy');toast('已复制')}catch(e){}">再试一次复制</button>`;
    $('#drawer').classList.add('open');
    setTimeout(() => { const t = $('#waText'); t.focus(); t.select(); }, 50);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fallback);
  else fallback();
}
function sameOwner(r){
  const k = (r.owner_phone||'').replace(/\D/g,'') || (r.owner_name||'').trim().toUpperCase();
  const grp = rows.filter(x => x.id !== r.id && x.status !== 'CLOSED' && paymentEligible(x) && (((x.owner_phone||'').replace(/\D/g,'') || (x.owner_name||'').trim().toUpperCase()) === k));
  return [r, ...grp];
}

/* ---------- settings (agents / financiers editable in-page) ---------- */
let settings = { agents: [], financiers: [], partners: [] }, settingsRevision=0;
function partnerList(){ return (settings.partners||[]).map(p => typeof p === 'string' ? {name:p, phone:''} : p); }
function allPartners(){ return [...new Set([...partnerList().map(p => p.name), ...rows.map(r => r.partner).filter(Boolean)])].sort(); }
function partnerPhone(n){ const p = partnerList().find(x => x.name === n); return p ? (p.phone||'') : ''; }
function allFins(){ return [...FINS, ...settings.financiers.filter(f => !FINS.some(x => x.code === f.code))]; }
function allAgents(){ return [...new Set([...AGENTS, ...settings.agents, ...rows.map(r => r.agent).filter(Boolean)])].sort(); }
async function saveSettings(){ const saved=await db.doc('settings/lists').set({ ...settings, updated_at: new Date().toISOString(), by: me.name || me.id || '?' },settingsRevision); settingsRevision=saved.data()._rental_revision; }
function openSettings(){
  if (!canEdit()) return;
  resetPanel('settings');
  $('#panel').innerHTML = `<h2>设定 Settings<button class="x" onclick="closeDrawer()">×</button></h2>
  <h2 style="margin-top:12px">Agents</h2>
  <div class="hint">${allAgents().map(esc).join(' · ')}</div>
  <div class="row" style="margin-top:8px"><input id="s_agent" placeholder="新 agent 名字 New agent" style="flex:1"><button class="btn primary" id="s_addAgent">+ 加 Add</button></div>
  <h2 style="margin-top:18px">财务公司 Financiers</h2>
  <table class="pays"><thead><tr><th>代号 Code</th><th>全名 Full name</th><th>付款银行 Pay via</th><th>户口规则 Rule</th></tr></thead><tbody>
  ${allFins().map(f => `<tr><td><b>${esc(f.code)}</b></td><td>${esc(f.name||'')}</td><td>${esc(f.bank||'')}</td><td class="hint">${esc(f.acct_digits ? f.acct_digits+' 位'+(f.acct_prefixes?.length?' 开头 '+f.acct_prefixes.join('/'):'') : (f.fixed_account?'固定户口':'未设规则 no rule'))}</td></tr>`).join('')}
  </tbody></table>
  <div class="row" style="margin-top:8px"><input id="s_code" placeholder="代号 Code (e.g. OE)" style="width:120px"><input id="s_name" placeholder="全名 Full name" style="flex:1"><input id="s_bank" placeholder="付款银行 Pay via" style="width:130px"><button class="btn primary" id="s_addFin">+ 加 Add</button></div>
  <p class="hint">新加的财务公司先不验证户口格式，规则由管理层核实后设定。 New financiers are saved without an account rule; rules are set by management.</p>
  <h2 style="margin-top:18px">租车伙伴 Rental partners</h2>
  <table class="pays"><tbody>${partnerList().map((p,i) => `<tr><td><b>${esc(p.name)}</b></td><td><input id="pp_${i}" value="${esc(p.phone||'')}" placeholder="电话 Phone" style="width:160px;text-transform:none"></td><td><button class="btn" style="font-size:12px;padding:4px 10px" onclick="savePartnerPhone(${i})">保存 Save</button></td></tr>`).join('') || '<tr><td class="hint">—</td></tr>'}</tbody></table>
  <div class="row" style="margin-top:8px"><input id="s_partner" placeholder="租车公司 / agent 名字 e.g. M2" style="flex:1"><input id="s_pphone" placeholder="电话 Phone" style="width:150px"><button class="btn primary" id="s_addPartner">+ 加 Add</button></div>`;
  $('#drawer').classList.add('open');
  $('#s_addFin').onclick = async () => {
    const code = $('#s_code').value.trim().toUpperCase(), name = $('#s_name').value.trim().toUpperCase(), bank = $('#s_bank').value.trim().toUpperCase();
    if (!code || !name || !bank) { toast('代号、全名、付款银行必填 Code, name, bank required'); return; }
    if (allFins().some(f => f.code === code)) { toast('已经有这个代号 Code exists'); return; }
    settings.financiers.push({ code, name, bank, acct_digits: null, acct_prefixes: [], acct_suffix: null, fixed_account: null, needs_reference: false });
    await saveSettings(); fins = allFins(); toast('已加 ' + code); openSettings();
  };
  $('#s_addPartner').onclick = async () => {
    const p = $('#s_partner').value.trim().toUpperCase(), ph = $('#s_pphone').value.trim(); if (!p) return;
    if (allPartners().includes(p)) { toast('已经有了 Exists'); return; }
    settings.partners = [...partnerList(), {name:p, phone:ph}]; await saveSettings(); toast('已加 ' + p); openSettings();
  };
  $('#s_addAgent').onclick = async () => {
    const a = $('#s_agent').value.trim().toUpperCase(); if (!a) return;
    if (allAgents().includes(a)) { toast('已经有这个 agent'); return; }
    settings.agents.push(a); await saveSettings(); toast('已加 ' + a); openSettings();
  };
}
$('#btnSettings').onclick = openSettings;
async function savePartnerPhone(i){
  const list = partnerList(); const ph = (document.getElementById('pp_'+i)?.value || '').trim();
  list[i] = { ...list[i], phone: ph }; settings.partners = list;
  try { await saveSettings(); toast(`已保存 ${list[i].name}`); } catch (e) { toast('失败 Failed: ' + (e.message||e.code)); }
}

/* ---------- add / edit form (admin: loan + owner data) ---------- */
const F = [
  ['plate','车牌 Plate','text',1],['brand','品牌 Brand','text',1],['model','型号 Model','text',1],['year','年份 Year','text',1],
  ['owner_name','车主 Owner name（打几个字母会出现旧车主，选了自动填电话）','text',1],['owner_phone','车主电话 Owner phone','tel',1],['agent','Agent','select',1],
  ['financier','财务公司 Financier','select',1],
  ['pending_disbursement','⏳ 贷款还没放款 Loan not disbursed yet（户口号码、首期日先留空；车先入库接 pre-booking，不能租出 · account no & first payment left blank; pre-booking only, no rent-out）','check'],
  ['account_no','户口号码 Account / Agreement No','text',1],['jompay_ref2','JomPAY Ref-2 = Agreement No（从 payment advice / officer 拿）','text'],
  ['loan_amount','贷款额 Loan RM','number',1],['monthly','月供 Monthly RM','number',1],['tenure','期数 Tenure (months)','number',1],
  ['first_payment_date','首期日 First payment','date',1],['due_day','每月几号 Due day','text'],['deliver_date','交车日 Delivery date','date'],
  ['paid_count_excel','系统外已付期数 Paid before system（对 officer 的 statement 填）','number'],
];
function owners(){
  const m = new Map();
  rows.forEach(r => { const k = (r.owner_name||'').trim().toUpperCase(); if (!k) return; const o = m.get(k) || {name:k, phone:r.owner_phone||'', agent:r.agent||'', n:0}; o.n++; if (!o.phone && r.owner_phone) o.phone = r.owner_phone; m.set(k,o); });
  return [...m.values()].sort((a,b) => a.name.localeCompare(b.name));
}
function formHtml(r = {}){
  return `<div class="row">` + F.map(([k,l,t,req]) => {
    let inp;
    if (t === 'select') {
      const o = k === 'financier' ? allFins().map(f=>f.code) : allAgents();
      inp = `<select id="f_${k}"><option value="">—</option>${o.map(v=>`<option ${r[k]===v?'selected':''}>${esc(v)}</option>`).join('')}</select>`;
    } else if (t === 'check') {
      return `<div class="field check" id="w_${k}"><label style="color:var(--ink)"><input type="checkbox" id="f_${k}" ${r[k]===true?'checked':''}> ${l}</label><div class="errmsg" id="e_${k}"></div></div>`;
    } else {
      inp = `<input id="f_${k}" type="${t}" value="${esc(r[k] ?? '')}" ${t==='number'?'inputmode="decimal" min="0"':''} ${k==='account_no'?'inputmode="numeric"':''} ${k==='owner_name'?'list="ownerList" autocomplete="off"':''}>`;
    }
    return `<div class="field" id="w_${k}"><label>${l}${req?' *':''}</label>${inp}<div class="errmsg" id="e_${k}"></div></div>`;
  }).join('') + `</div>
  <datalist id="ownerList">${owners().map(o => `<option value="${esc(o.name)}">${esc(o.phone)}${o.n>1?' · '+o.n+' 台':''}</option>`).join('')}</datalist>
  <div class="payto"><span class="hint" id="ruleHint"></span><b id="payPreview" class="mono"></b></div>
  <div id="sanity" class="card" hidden style="border-color:var(--fail);background:var(--fail-bg);color:var(--fail)"><b id="sanityMsg"></b><br><label style="color:var(--fail);margin-top:6px"><input type="checkbox" id="sanityOk"> 我已经对过 LOU，数字没错 I checked the LOU, figures are correct</label></div>
  <div class="row"><button class="btn primary" id="btnSave">${r.id?'保存修改 Save changes':'保存车辆 Save car'}</button><button class="btn" id="btnCancel">取消 Cancel</button></div>`;
}
function validate(){
  const v = {}; let ok = true;
  F.forEach(([k,l,t,req]) => {
    if (t === 'check') { v[k] = $('#f_'+k).checked; $('#e_'+k).textContent = ''; return; }
    let x = $('#f_'+k).value.trim();
    if (t === 'number') x = x === '' ? null : Number(x);
    if (t === 'text' || t === 'tel') x = x.toUpperCase();
    if (k === 'plate') x = x.replace(/\s+/g,'');
    if (k === 'account_no') x = x.replace(/\D/g,'');
    if (k === 'monthly' && x !== null) x = Math.round(x);
    v[k] = x === '' ? null : x;
    let err = '';
    const optionalWhilePending = v.pending_disbursement && (k === 'account_no' || k === 'first_payment_date');
    if (req && (x === null || x === '') && !(k === 'account_no' && v.financier === 'CARSOME') && !optionalWhilePending) err = '必填 Required';
    else if (optionalWhilePending && (x === null || x === '') ) err = '';
    else if (t === 'number' && x !== null && (isNaN(x) || x < 0 || (x === 0 && k !== 'paid_count_excel'))) err = '只能是正数 Positive number only';
    else if (k === 'tenure' && x && (x < 12 || x > 120)) err = '期数应在 12 到 120 之间';
    else if (k === 'plate' && rows.some(rr => rr.id !== window.__editingId && plateKey(rr.plate) === plateKey(x))) err = '这个车牌已经在系统里 Plate already exists';
    if (k === 'plate' && window.__editingId) { const pm = $('#plateMove'); if (pm) pm.hidden = !(x && x !== (rows.find(rr => rr.id === window.__editingId)||{}).plate); }
    else if (k === 'account_no') err = (optionalWhilePending && !x) ? '' : checkAccount(v.financier, x, v.plate);
    else if (k === 'jompay_ref2' && v.financier === 'CARSOME' && x && !/^\d{6,}$/.test(x)) err = 'Ref-2 只能是数字 Digits only';
    $('#e_'+k).textContent = err; $('#w_'+k).classList.toggle('err', !!err);
    if (err) ok = false;
  });
  // plausibility: implied flat rate = (monthly*tenure/loan - 1) / years
  let bad = '';
  if (v.loan_amount && v.monthly && v.tenure) {
    const yrs = v.tenure / 12, total = v.monthly * v.tenure, rate = (total / v.loan_amount - 1) / yrs * 100;
    if (rate < 2) bad = `月供偏低：RM${v.monthly} × ${v.tenure} 期 = RM${total.toLocaleString('en-MY')}，比贷款额 RM${v.loan_amount.toLocaleString('en-MY')} 还少或差不多（利率 ${rate.toFixed(1)}%）。Monthly looks too LOW vs loan.`;
    else if (rate > 13) bad = `月供偏高：按 RM${v.loan_amount.toLocaleString('en-MY')} 借 ${yrs.toFixed(1)} 年，月供 RM${v.monthly} 等于年利率 ${rate.toFixed(1)}%，不合理。Monthly looks too HIGH vs loan.`;
  }
  $('#sanity').hidden = !bad; $('#sanityMsg').textContent = bad;
  if (bad && !$('#sanityOk').checked) ok = false;
  if (!bad) $('#sanityOk').checked = false;
  const f = rule(v.financier);
  $('#ruleHint').textContent = ruleText(f);
  $('#payPreview').textContent = v.pending_disbursement && !v.account_no ? '⏳ 待放款，拿到 disbursement 后再填户口号码和首期日 · Pending disbursement' : v.financier ? payTo(v.financier, v.account_no, v.plate, v.jompay_ref2) : '';
  $('#f_account_no').readOnly = !!(f?.fixed_account && v.financier !== 'CARSOME');
  if (f?.fixed_account && v.financier !== 'CARSOME') { $('#f_account_no').value = f.fixed_account; v.account_no = f.fixed_account; $('#e_account_no').textContent='固定户口，不能改 Fixed account'; $('#w_account_no').classList.remove('err'); }
  $('#w_jompay_ref2').style.display = v.financier === 'CARSOME' ? '' : 'none';
  $('#w_account_no').style.display = v.financier === 'CARSOME' ? 'none' : '';
  if (v.financier === 'CARSOME') { v.account_no = '82008'; $('#e_account_no').textContent=''; $('#w_account_no').classList.remove('err'); if (!v.jompay_ref2) v.check_note_auto = 'CARSOME REF-2 (AGREEMENT NO) 还没拿到，要向 officer 问'; }
  if (f?.needs_reference) v.pay_reference = v.plate;
  v.bank = f?.bank || null;
  return {ok, v};
}
function stockPickerHTML(){
 return `<section class="stockPicker" aria-labelledby="stockPickerTitle">
  <h3 id="stockPickerTitle">从网站库存选车 / Choose from Stock List</h3>
  <label for="stockPlate">筛选车牌 / Filter plate</label>
  <input id="stockPlate" data-no-draft autocomplete="off" placeholder="输入部分车牌，例如 ABC / 1234">
  <p id="stockStatus" class="hint" role="status">正在读取库存 / Loading stock…</p>
  <div id="stockResults" class="stockResults"></div>
  <button type="button" id="stockRetry" class="btn" hidden>重试 / Retry</button>
  <p id="stockSelected" class="hint" role="status"></p>
  <p class="hint">选车后带入车牌、品牌、型号和年份；车主及贷款资料另填。找不到的车可在下方手动填写。<br>Select a car to fill its details, or enter them manually below.</p>
 </section>`;
}
function setupStockPicker(onSelect){
 const token=authEpoch,version=panelVersion;
 const current=()=>token===authEpoch&&version===panelVersion&&panelKind==='form';
 let cars=null;
 const draw=()=>{
  if(!current()||!cars)return;
  const matches=rentalStockMatches(cars,$('#stockPlate').value),shown=matches.slice(0,20);
  $('#stockStatus').textContent=matches.length?`${matches.length} 台匹配 / matches${matches.length>20?' · 显示前 20 台，请继续输入车牌 / Type more to narrow results':''}`:'没有匹配车辆，可换车牌或在下方手动填写 / No matching stock; try another plate or enter manually.';
  $('#stockResults').replaceChildren();
  for(const car of shown){
   const duplicate=rows.some(r=>plateKey(r.plate)===plateKey(car.plate));
   const button=document.createElement('button');button.type='button';button.className='btn stockChoice';button.disabled=duplicate;
   const plate=document.createElement('b');plate.textContent=car.plate;
   const detail=document.createElement('span');detail.textContent=[car.brand,car.model,car.variant,car.year,car.stock_status,duplicate?'已在租车记录 / Already added':''].filter(Boolean).join(' · ');
   button.append(plate,detail);button.onclick=()=>{
    if(!current())return;
    if(rows.some(r=>plateKey(r.plate)===plateKey(car.plate))){draw();toast('这个车牌已在租车记录 / Already added');return;}
    onSelect(car);
   };$('#stockResults').append(button);
  }
 };
 const load=async()=>{
  if(!current())return;
  $('#stockRetry').hidden=true;$('#stockStatus').textContent='正在读取库存 / Loading stock…';
  try{const result=await loadRentalStock(sb,authorized);if(!current())return;cars=result;draw();}
  catch{if(!current())return;$('#stockStatus').textContent='暂时无法读取库存，可重试或在下方手动填写 / Stock unavailable; retry or enter manually.';$('#stockRetry').hidden=false;}
 };
 $('#stockPlate').oninput=draw;$('#stockRetry').onclick=load;void load();
}
function openForm(r){
  if (!canEdit()) return;
  resetPanel('form');
  let selectedStock=null;
  $('#panel').innerHTML = `<h2>${r?'修改车辆资料 Edit '+esc(r.plate):'新增车辆 Add car'}<button class="x" onclick="closeDrawer()">×</button></h2>${r?'':stockPickerHTML()}
    <p class="hint">Admin 栏位：贷款与车主资料。户口号码只能从 LOU 抄，格式不对存不进去。 Admin section: loan & owner data. Copy the account number from the LOU only.</p>` + formHtml(r||{});
  window.__editingId = r ? r.id : null;
  if (r) { $('#f_plate').insertAdjacentHTML('afterend', '<div id="plateMove" class="hint" hidden style="color:var(--warn)">⚠ 改车牌会把整笔记录（付款、交接、历史）一次过搬到新车牌，旧车牌保留为「已搬移」并从列表隐藏，操作记录可查。 Changing the plate moves this whole record to the new plate in one step; the old one is kept as MOVED and hidden from lists.</div>'); }
  $('#drawer').classList.add('open');
  $('#panel').querySelectorAll('input,select').forEach(el => el.addEventListener('input', validate));
  $('#sanityOk').addEventListener('change', validate);
  $('#f_owner_name').addEventListener('input', () => {
    const o = owners().find(x => x.name === $('#f_owner_name').value.trim().toUpperCase());
    if (o) { if (!$('#f_owner_phone').value) $('#f_owner_phone').value = o.phone; if (!$('#f_agent').value && o.agent) $('#f_agent').value = o.agent; validate(); toast(`已带入 ${o.name} 的资料 Owner found`); }
  });
  if(!r){
    setupStockPicker(car=>{
      selectedStock=car;
      for(const [key,value] of Object.entries(rentalStockDetails(car))){
        const el=$('#f_'+key);el.value=value;trackDraft({target:el});
      }
      $('#stockSelected').textContent='已选 / Selected: '+car.plate+' · '+[car.brand,car.model,car.year].filter(Boolean).join(' ');
      validate();$('#f_owner_name').focus();
    });
    $('#f_plate').addEventListener('input',()=>{
      if(selectedStock&&plateKey($('#f_plate').value)!==plateKey(selectedStock.plate)){
        selectedStock=null;$('#stockSelected').textContent='已切换手动填写 / Manual entry';
      }
    });
  }
  validate();
  $('#btnCancel').onclick = () => r ? openDetail(r.id) : closeDrawer();
  $('#btnSave').onclick = async () => {
    const {ok, v} = validate();
    if (!ok) { toast($('#sanity').hidden ? '还有栏位不对，请看红色提示 Fix the red fields' : '月供和贷款额对不上，请先对 LOU 再勾确认 Check LOU first'); return; }
    if(selectedStock&&plateKey(v.plate)===plateKey(selectedStock.plate))v.stock_vehicle_id=selectedStock.id;
    $('#btnSave').disabled = true;
    let savedId;
    try { savedId = await saveContract(v, r); }
    catch (e) { if($('#btnSave'))$('#btnSave').disabled = false; toast('保存失败 Save failed: ' + (e.message || e.code)); return; }
    if(!me)return;if($('#btnSave'))$('#btnSave').disabled = false;
    panelDrafts.clear();window.__dirty=false;
    const movedTo = r && savedId && savedId !== r.id ? savedId : null;
    toast(movedTo ? `已改车牌并搬到 ${v.plate}` : r ? '已保存 Saved' : '已新增 Added ' + v.plate);
    if (movedTo) { closeDrawer(); window.__pendingOpen = movedTo; } else { r ? openDetail(r.id) : closeDrawer(); }
  };
}
$('#btnAdd').onclick = () => openForm(null);
function closeDrawer(){
  if ((window.__dirty||panelDrafts.size)&&!discardArmed) {
    discardArmed=true;toast('⚠ 有资料还没保存！再按一次关闭才放弃 Unsaved changes — press close again to discard');return;
  }
  $('#drawer').classList.remove('open');resetPanel();
}
$('#drawer').addEventListener('click', e => { if (e.target === e.currentTarget) closeDrawer(); });

/* ---------- rental ops (rental team): rent out / return / void / extras ---------- */
async function patch(r, data, action,prefix='c_'){
  return saveDetail(r,data,action,prefix);
}
const patch_ = patch;
function bookingCard(r){
  if (r.booking) return `<div class="card pendingNote" style="margin-top:10px"><h2>📌 已预订 Reserved · ${esc(r.booking.to||'')}</h2>
    <div class="hint" style="margin:4px 0 8px">${esc(r.booking.partner||'DIRECT')} · ${esc(r.booking.phone||'')} · ${esc(fd(r.booking.date))}${r.booking.deposit?' · 订金 deposit <b>'+money(r.booking.deposit)+'</b>':''}${r.booking.note?' · '+esc(r.booking.note):''}${r.booking.by?'<br><span class="hint">'+esc(fd(String(r.booking.at||'').slice(0,10))+' '+r.booking.by)+'</span>':''}<br>放款后补齐贷款资料，租出表单会自动带入这笔预订。 After disbursement, completing the loan data pre-fills the rent-out form from this booking.</div>
    <button class="btn danger" id="btnCancelBooking">取消预订 Cancel booking</button></div>`;
  return `<div class="card" style="margin-top:10px"><h2>📌 记录预订 Pre-booking</h2>
    <p class="hint" style="margin:0 0 8px">租客或 agent 已下订、付了订金，先记下来免得重复订车。这不是交接，车还没交出去。 Renter / agent reserved this car with a deposit. Not a handover — the car stays with us.</p>
    <div class="row">
      <div class="field"><label>来源 Source *</label><select id="b_partner"><option value="">—</option><option value="DIRECT">直接租客 Direct</option>${allPartners().map(p=>`<option>${esc(p)}</option>`).join('')}</select></div>
      <div class="field" style="flex:2"><label>订车人 Booked by *</label><input id="b_to" placeholder="租客名字 Renter name"></div>
      <div class="field"><label>电话 Phone *</label><input id="b_phone" type="tel" inputmode="tel" placeholder="01x-xxxxxxx"></div>
      <div class="field"><label>订车日期 Booking date *</label><input id="b_date" type="date" value="${today()}"></div>
      <div class="field"><label>订金 Deposit RM *</label><input id="b_deposit" type="number" inputmode="decimal" placeholder="booking fee"></div>
      <div class="field" style="flex:2"><label>备注 Note</label><input id="b_note"></div>
    </div>
    <button class="btn primary" id="btnBook" style="margin-top:8px">记录预订 Save booking</button>
  </div>`;
}
async function saveBooking(r){
  if (!r.pending || r.booking || r.rented || r.status === 'CLOSED') throw Error('当前车辆不能新增预订 Booking unavailable');
  const src = $('#b_partner').value; if (!src) { toast('请选来源 Source'); return; }
  const to = $('#b_to').value.trim().toUpperCase(), phone = $('#b_phone').value.trim(), d = $('#b_date').value, dep = Number($('#b_deposit').value), note = UP($('#b_note').value.trim());
  if (!to) { toast('请填订车人 Booked by'); return; }
  if (!phone) { toast('请填电话 Phone'); return; }
  if (!d) { toast('请选日期 Date'); return; }
  if (!Number.isFinite(dep) || !(dep > 0)) { toast('请填订金 Deposit'); return; }
  const b = { to, phone, partner: src === 'DIRECT' ? '' : src, date: d, deposit: dep, note, by: me.name || me.id || '?', at: new Date().toISOString() };
  if (!await patch(r, { booking: b }, `预订 ${to}${b.partner?' ['+b.partner+']':''} 订金 RM${dep}`, 'b_')) return;
  toast(`${r.plate} 已记录预订 ${to}`);
}
async function cancelBooking(r){
  const b = r.booking; if (!b) return;
  const hist = [...(Array.isArray(r.booking_history) ? r.booking_history : []), { ...b, status: 'CANCELLED', cancelled_by: me.name || me.id || '?', cancelled_at: new Date().toISOString() }];
  if (!await patch(r, { booking: null, booking_history: hist }, `取消预订 ${b.to}${b.deposit?'（订金 RM'+b.deposit+'）':''}`, 'b_')) return;
  toast(`${r.plate} 预订已取消`);
}
async function rentOut(r){
  if (r.pending) { toast('待放款的车不能租出 Pending disbursement — cannot rent out'); return; }
  const to = $('#h_to').value.trim().toUpperCase(), phone = $('#h_phone').value.trim(), d = $('#h_date').value, rent = Number($('#h_rent').value) || null, note = UP($('#h_note').value.trim());
  const src = $('#h_partner').value; if (!src) { toast('请选来源 Source'); return; }
  const partner = src === 'DIRECT' ? '' : src;
  if (!to) { toast('请填租给谁 To whom'); return; }
  if (!phone) { toast('请填电话 Phone'); return; }
  if (!d) { toast('请选日期 Date'); return; }
  if (r.booking && (!Number.isFinite(rent) || rent < Number(r.booking.deposit))) { toast('实际 upfront 必须包含已收订金 Total upfront must include the booking deposit'); return; }
  const h = { type:'OUT', to, phone, partner, date:d, rent, note, by: me.name || me.id || '?', at: new Date().toISOString() };
  const data = { handovers: [...r.handovers, h], actual_rent: rent ?? r.actual_rent ?? null };
  if (r.booking) { h.deposit = r.booking.deposit || null; data.booking = null; data.booking_history = [...(Array.isArray(r.booking_history) ? r.booking_history : []), { ...r.booking, status: 'CONVERTED', converted_at: h.at }]; }
  if (!await patch(r, data, `租出给 ${to}${rent?' RM'+rent:''}${r.booking?'（由预订转入 from booking）':''}`,'h_')) return;
  toast(`${r.plate} 已租出给 ${to}`);
}
async function returnCar(r){
  const d = $('#r_date').value, note = UP($('#r_note').value.trim()), how = $('#r_type').value;
  if (!how) { toast('请选拉回方式 Type'); return; }
  if (!d) { toast('请选日期 Date'); return; }
  const h = { type:'IN', how, to:'', date:d, note, by: me.name || me.id || '?', at: new Date().toISOString() };
  await patch(r, { handovers: [...r.handovers, h] }, `拉回 ${how} ${note||''}`.trim(),'r_');
  toast(`${r.plate} 已记录拉回`);
}
function editingHandoverIndex(){ const m = [...panelDrafts.keys()].map(k => /^eh_(\d+)_/.exec(k)).find(Boolean); return m ? Number(m[1]) : (document.querySelector('[id^="eh_"][id$="_to"],[id^="eh_"][id$="_how"]') ? Number(document.querySelector('[id^="eh_"]').id.split('_')[1]) : null); }
function askEditHand(cid, idx){
  const r = panelRecord?.id===cid?panelRecord:null; if (!r) return;
  const h = r.handovers[idx]; const row = document.getElementById('hr_'+idx); if (!h || !row || h.void) return;
  const open = editingHandoverIndex();
  if (open !== null && open !== idx) { toast(`先保存或取消第 ${open+1} 条的编辑 Finish editing entry #${open+1} first`); document.getElementById('hr_'+open)?.scrollIntoView({block:'center'}); return; }
  const P = `eh_${idx}_`;
  const sel = (k, label, opts, cur) => `<div class="field"><label>${label}</label><select id="${P}${k}">${opts.map(o => `<option value="${esc(o[0])}" ${o[0]===cur?'selected':''}>${esc(o[1])}</option>`).join('')}</select></div>`;
  const inp = (k, label, val, ph, type='text', flex='') => `<div class="field" style="${flex}"><label>${label}</label><input id="${P}${k}" type="${type}" value="${esc(val ?? '')}" placeholder="${ph}" ${type==='number'?'inputmode="decimal" min="0"':''} ${type==='tel'?'inputmode="tel"':''}></div>`;
  const fields = h.type === 'OUT'
    ? `${sel('partner','来源 Source',[['DIRECT','直接租客 Direct'],...allPartners().map(p=>[p,p])], h.partner||'DIRECT')}${inp('to','租给谁 To whom',h.to,'租客名字 Renter name','text','flex:2')}${inp('phone','电话 Phone',h.phone,'01x-xxxxxxx','tel')}${inp('date','日期 Date',h.date,'','date')}${inp('rent','收到 Upfront RM',h.rent??'','','number')}${inp('note','备注 Note',h.note,'','text','flex:2')}`
    : `${sel('how','方式 Type',[['REPO','REPO'],['REDEEM','REDEEM'],['RETURN','RETURN']], h.how||'RETURN')}${inp('date','日期 Date',h.date,'','date')}${inp('note','备注 Note',h.note,'','text','flex:2')}`;
  row.style.borderColor = 'var(--gold)';
  row.innerHTML = `<div style="flex:1"><h2 style="margin-bottom:6px">修改交接 #${idx+1} Edit handover ${h.type==='OUT'?'· 租出 OUT':'· 拉回 IN'}</h2>
    <div class="row">${fields}</div>
    <div class="row" style="margin-top:8px"><button class="btn primary" onclick="saveEditHand('${esc(cid)}',${idx})">保存 Save</button><button class="btn" onclick="cancelEditHand('${esc(cid)}',${idx})">取消 Cancel</button></div></div>`;
  // Register the opened editor as a draft so auto-refresh / Realtime cannot wipe it before the user types.
  row.querySelectorAll('input,select').forEach(el => panelDrafts.set(el.id, fieldValue(el)));
  window.__dirty = true; discardArmed = false;
  row.querySelector(`#${P}${h.type==='OUT'?'to':'date'}`)?.focus();
}
function cancelEditHand(cid, idx){
  if (panelRecord?.id !== cid) return;
  const row = document.getElementById('hr_'+idx), h = panelRecord.handovers[idx];
  if (!row || !h) return;
  for (const k of [...panelDrafts.keys()]) if (k.startsWith(`eh_${idx}_`)) panelDrafts.delete(k);
  // Replace only this editor; rebuilding the detail would discard unrelated drafts.
  row.outerHTML = handoverRow(h, idx, cid);
  window.__dirty = panelDrafts.size > 0;
  discardArmed = false;
}
async function saveEditHand(cid, idx){
  const r = panelRecord?.id===cid?panelRecord:null; if (!r) return;
  const h = r.handovers[idx]; const row = document.getElementById('hr_'+idx); if (!h || !row) return;
  const g = k => (row.querySelector(`#eh_${idx}_${k}`)?.value ?? '').trim();   // read from this row only
  let patch;
  if (h.type === 'OUT') {
    const src = g('partner'), to = UP(g('to')), phone = g('phone'), date = g('date'), rentRaw = g('rent');
    if (!to) { toast('请填租给谁 To whom'); return; }
    if (!phone) { toast('请填电话 Phone'); return; }
    if (!date) { toast('请选日期 Date'); return; }
    if (rentRaw && !(Number(rentRaw) >= 0)) { toast('Upfront 只能是数字'); return; }
    patch = { to, phone, partner: src === 'DIRECT' ? '' : src, date, rent: rentRaw ? Number(rentRaw) : null, note: UP(g('note')) };
  } else {
    const how = g('how'), date = g('date');
    if (!date) { toast('请选日期 Date'); return; }
    patch = { how, date, note: UP(g('note')) };
  }
  try {
    const changed = await editHandover(r, idx, patch);
    if (!changed) { toast('没有改动 No change'); cancelEditHand(cid, idx); return; }
    toast(`已修改交接 #${idx+1}`);
  } catch (e) { toast('失败 Failed: ' + (e.message||e.code)); }
}
function askVoid(cid, idx){
  const cell = document.getElementById('vh_'+idx); if (!cell) return;
  cell.innerHTML = `<input id="vr_${idx}" placeholder="作废原因 Reason" style="width:150px"> <button class="btn danger" onclick="voidHand('${esc(cid)}',${idx})">确定 OK</button>`;
  document.getElementById('vr_'+idx).focus();
}
async function voidHand(cid, idx){
  const r = panelRecord?.id===cid?panelRecord:null; if (!r) return;
  const reason = UP((document.getElementById('vr_'+idx)?.value || '').trim());
  if (!reason) { toast('请填作废原因 Reason required'); return; }
  const list = r.handovers.map((h,i) => i === idx ? { ...h, void: true, void_by: me.name || me.id || '?', void_at: new Date().toISOString(), void_reason: reason } : h);
  try { await patch(r, { handovers: list }, `作废交接 #${idx+1}: ${reason}`,'vr_'); toast('已作废 Voided'); }
  catch (e) { toast('失败 Failed: ' + (e.message||e.code)); }
}
async function closeContract(r){
  const reason = $('#c_reason').value; if (!reason) { toast('请选原因 Select reason'); return; }
  if (r.check) {
    const box = $('#closeCheck');
    if (box.hidden) { box.hidden = false; toast('⚠ 这台车还有待核实事项，先选怎么处理 Pending item — choose first'); return; }
    const how = $('#c_checkhow').value;
    if (!how) { toast('请选待核实怎么处理 Choose how to handle the pending item'); return; }
    if (how === 'clear') { await patch(r, { car_status: reason, closed_at: today(), check_note: '' }, `结束合约 ${reason}（待核实已处理：${r.check_note}）`); toast(`${r.plate} 已结束，待核实已清`); return; }
  }
  await patch(r, { car_status: reason, closed_at: today() }, `结束合约 ${reason}${r.check?'（待核实未处理，保留）':''}`);
  toast(`${r.plate} 已结束 ${reason}`);
}
async function reopenContract(r){
  await patch(r, { car_status: 'SOLD', closed_at: null }, '重新开启合约');
  toast(`${r.plate} 已重新开启`);
}
async function saveExtras(r){
  const data = {
    gps: $('#x_gps').checked, spare_key: $('#x_key').checked,
    target_price: Number($('#x_target').value) || null,
    adv_installment: Number($('#x_adv').value) || null,
    adv_status: $('#x_advok').value,
    adv_collected: $('#x_advok').value === 'COLLECTED',
    notes: UP($('#x_notes').value.trim()),
    check_note: UP($('#x_check').value.trim()),
  };
  await patch(r, data, '更新租车资料 / 备注','x_');
  toast('已保存 Saved');
}

/* ---------- detail ---------- */
function handoverRow(h, i, id){
  const v = h.void;
  const typ = h.type === 'IN' ? `<span class="chip s-UPCOMING">${esc(h.how||'拉回 IN')}</span>` : '<span class="chip s-OK">租出 OUT</span>';
  const meta = [h.date ? esc(h.date) : '', h.rent ? '收到 upfront <b>'+money(h.rent)+'</b>' : '', h.deposit ? '含订金 deposit '+money(h.deposit) : '', h.partner ? '<span class="chip s-UNK" style="font-size:11px">'+esc(h.partner)+'</span>' : ''].filter(Boolean).join(' · ');
  const trail = [h.by ? '记录 '+esc(h.by) : '', h.edited_at ? '已修改 edited by '+esc(h.edited_by||'')+' '+fd((h.edited_at||'').slice(0,10))+(Array.isArray(h.edit_log)&&h.edit_log.length?' · 原本 was: '+esc(Object.entries(h.edit_log[h.edit_log.length-1].before||{}).map(([k,val])=>k+'='+(val===''||val===null?'—':val)).join(', ')):'') : '', v ? '作废 VOID by '+esc(h.void_by||'')+' '+fd((h.void_at||'').slice(0,10))+': '+esc(h.void_reason||'') : ''].filter(Boolean).join('<br>');
  return `<div class="card handRow" id="hr_${i}" style="${v?'opacity:.55':''}">
    <div class="handMain" style="${v?'text-decoration:line-through':''}">
      <div class="handHead"><span class="hint">#${i+1}</span> ${typ} <b>${esc(h.to||(h.type==='IN'?'拉回':'—'))}</b>${h.phone?' <span class="hint">'+esc(h.phone)+'</span>':''}</div>
      ${meta?`<div class="hint">${meta}</div>`:''}
      ${h.note?`<div>${esc(h.note)}</div>`:''}
      ${trail?`<div class="hint" style="font-size:12px">${trail}</div>`:''}
    </div>
    ${canEdit()&&!v?`<div class="handActions" id="vh_${i}"><button class="btn" onclick="askEditHand('${esc(id)}',${i})">编辑 Edit</button><button class="btn" onclick="askVoid('${esc(id)}',${i})">作废 Void</button></div>`:''}
  </div>`;
}
async function openDetail(id, refresh){
  const r = rows.find(x => x.id === id); if (!r) return;
  resetPanel('detail');window.__openId=id;panelRecord=r;
  const pays = r.payments;
  const next = r.paid_count + 1;
  const checkChip = r.check ? `<div class="card" style="border-color:var(--warn);background:var(--warn-bg);color:var(--warn);margin-top:8px"><b>⚠ 待核实 To confirm：</b>${esc(r.check_note)}</div>` : '';
  const rentalChip = r.status==='CLOSED' ? `<span class="chip s-CLOSED">已结束 ${esc(r.car_status)}</span>` : r.rented ? `<span class="chip s-OK">已租出 Rented · ${esc(r.holder)}</span>` : r.booking ? `<span class="chip s-PENDING">已预订 Reserved · ${esc(r.booking.to||'')}</span>` : r.pending ? `<span class="chip s-PENDING">在库 · Pre-booking</span>` : `<span class="chip s-UPCOMING">在库 In stock</span>`;
  $('#panel').innerHTML = `<h2>${esc(r.plate)} ${rentalChip}${r.pending?'':' <span class="chip s-'+esc(r.status)+'">'+STATUS_CN[r.status]+'</span>'}<button class="x" onclick="closeDrawer()">×</button></h2>
  <div class="hint">${esc([r.brand,r.model,r.year].filter(Boolean).join(' '))} · ${esc(r.owner_name||'')} ${esc(r.owner_phone||'')} · Agent ${esc(r.agent||'—')}${r.branch?' · (旧 branch: '+esc(r.branch)+')':''}</div>
  ${checkChip}

  <h2 style="margin-top:14px">租车 Rental <span class="hint" style="font-weight:400">· 租车 team 负责 rental team · 改了要按下面的「保存」 press Save after editing</span></h2>
  ${canEdit() ? `
  <div class="card">
    <div class="row">
      <div class="field"><label>Target 一次性费用 Upfront fee RM</label><input id="x_target" type="number" inputmode="decimal" value="${r.target_price ?? ''}"></div>
      <div class="field"><label>ADV instalment 向租客收 RM</label><input id="x_adv" type="number" inputmode="decimal" value="${r.adv_installment ?? ''}" placeholder="没有就留空"></div>
      <div class="field"><label>ADV 状态 Status</label><select id="x_advok"><option value="PENDING" ${r.adv_status==='PENDING'?'selected':''}>待收 Pending</option><option value="COLLECTED" ${r.adv_status==='COLLECTED'?'selected':''}>已收回 Collected</option><option value="LOST" ${r.adv_status==='LOST'?'selected':''}>收不回 Written off</option></select></div>
      <div class="field" style="flex:0 0 auto"><label>&nbsp;</label><label style="color:var(--ink)"><input type="checkbox" id="x_gps" ${r.gps?'checked':''}> GPS 已装</label></div>
      <div class="field" style="flex:0 0 auto"><label>&nbsp;</label><label style="color:var(--ink)"><input type="checkbox" id="x_key" ${r.spare_key?'checked':''}> Spare key 备用锁匙</label></div>
    </div>
    <div class="field" style="margin-top:6px"><label>备注 Notes</label><textarea id="x_notes" rows="2">${esc(r.notes||'')}</textarea></div>
    <div class="field" style="margin-top:6px"><label>⚠ 待核实 To confirm <span class="hint">（填了会在列表标黄，查清楚后清空）</span></label><input id="x_check" value="${esc(r.check_note||'')}" placeholder="e.g. 租给谁没记录 / booking 还是已出租"></div>
    <button class="btn" id="btnExtras" style="margin-top:8px">已保存 Saved</button>
  </div>` : `<div class="kv"><div>Target 租金</div><div>${money(r.target_price)||'—'}</div><div>ADV instalment</div><div>${money(r.adv_installment)||'—'}</div><div>GPS / Spare key</div><div>${r.gps?'GPS ✓':'GPS ✗'} · ${r.spare_key?'Key ✓':'Key ✗'}</div><div>备注</div><div>${esc(r.notes||'—')}</div></div>`}

  ${r.status==='CLOSED' && r.booking ? bookingCard(r) : ''}
  <h3 style="font-size:14px;margin:12px 0 6px">交接记录 Handovers${r.rented&&r.actual_rent?` · 收到 upfront <b>${money(r.actual_rent)}</b>`:''}</h3>
  <div class="handList">
  ${r.handovers.map((h,i)=>handoverRow(h,i,id)).join('') || '<div class="hint">还没有交接记录 No handovers yet</div>'}
  </div>
  ${canEdit() && r.status!=='CLOSED' && r.pending && !r.rented ? `
  <div class="card pendingNote" style="margin-top:10px"><h2>⏳ 待放款 Pending disbursement</h2>
    <p class="hint" style="margin:4px 0 8px">贷款还没放款，户口号码和首期日未知，所以还不能交车给租客。可以先接 pre-booking。Admin 拿到 disbursement 后在「修改贷款资料」填户口号码、首期日，并取消勾选「贷款还没放款」，才能记录租出。<br>Loan not disbursed yet — account no &amp; first payment date unknown, so the car cannot be handed over. Pre-booking only. Admin: fill in the account no and first payment date, untick "not disbursed", then rent out.</p>
    <button class="btn primary" id="btnPendingEdit">补齐贷款资料 Complete loan data</button>
  </div>
  ${bookingCard(r)}` : ''}
  ${canEdit() && r.status!=='CLOSED' && !(r.pending && !r.rented) ? (r.rented ? `
  <div class="card" style="margin-top:10px"><h2>拉回 Return car</h2>
    <div class="row"><div class="field"><label>方式 Type *</label><select id="r_type"><option value="">—</option><option value="REPO">REPO</option><option value="REDEEM">REDEEM</option><option value="RETURN">RETURN</option></select></div>
    <div class="field"><label>日期 Date</label><input id="r_date" type="date" value="${today()}"></div>
    <div class="field" style="flex:2"><label>备注 Note</label><input id="r_note"></div></div>
    <button class="btn primary" id="btnReturn" style="margin-top:8px">记录拉回 Save return</button>
  </div>` : `
  ${r.booking ? `<div class="card pendingNote" style="margin-top:10px"><h2>📌 已预订 Reserved · ${esc(r.booking.to||'')}</h2>
    <div class="hint" style="margin:4px 0 8px">${esc(r.booking.partner||'DIRECT')} · ${esc(r.booking.phone||'')} · ${esc(fd(r.booking.date))}${r.booking.deposit?' · 订金 deposit <b>'+money(r.booking.deposit)+'</b>':''}${r.booking.note?' · '+esc(r.booking.note):''}<br>放款已完成，下面「租出」已带入预订资料，确认交车日期和实际 upfront 后保存，预订就自动转成租出。 Loan disbursed — the rent-out form below is pre-filled from this booking; confirm the handover date and upfront to convert it.</div>
    <button class="btn danger" id="btnCancelBooking">取消预订 Cancel booking</button></div>` : ''}
  <div class="card" style="margin-top:10px"><h2>租出 Rent out</h2>
    <div class="row">
      <div class="field"><label>来源 Source *</label><select id="h_partner"><option value="">—</option><option value="DIRECT" ${r.booking&&!r.booking.partner?'selected':''}>直接租客 Direct</option>${allPartners().map(p=>`<option ${r.booking&&r.booking.partner===p?'selected':''}>${esc(p)}</option>`).join('')}</select></div>
      <div class="field" style="flex:2"><label>租给谁 To whom *</label><input id="h_to" placeholder="租客名字 Renter name" value="${esc(r.booking?.to||'')}"></div>
      <div class="field"><label>电话 Phone *</label><input id="h_phone" type="tel" inputmode="tel" placeholder="01x-xxxxxxx" value="${esc(r.booking?.phone||'')}"></div>
      <div class="field"><label>日期 Date *</label><input id="h_date" type="date" value="${today()}"></div>
      <div class="field"><label>实际收到 Actual upfront RM${r.booking?.deposit?' <span class="hint">（含订金 incl. deposit '+money(r.booking.deposit)+'）</span>':''}</label><input id="h_rent" type="number" inputmode="decimal" value="${r.booking ? Math.max(Number(r.target_price)||0, Number(r.booking.deposit)||0) : (r.target_price ?? '')}"></div>
      <div class="field" style="flex:2"><label>备注 Note</label><input id="h_note" value="${esc(r.booking?.note||'')}"></div>
    </div>
    <button class="btn primary" id="btnRentOut" style="margin-top:8px">记录租出 Save rent-out</button>
  </div>`) : ''}

  <h2 style="margin-top:18px">贷款 Loan <span class="hint" style="font-weight:400">· admin 负责</span></h2>
  <div class="payto"><span class="hint">付款去处 Pay to · ${esc(finName(r.financier))}</span>${r.pending&&!r.account_no?'<b style="font-size:14px">⏳ 待放款，还没有户口号码 Pending disbursement — no account yet</b>':'<b class="mono">'+esc(payTo(r.financier, r.account_no, r.pay_reference||r.plate, r.jompay_ref2))+'</b>'}</div>
  ${(() => { if (r.pending) return `<p class="hint" style="margin:6px 0 12px">放款后才会有 WhatsApp 付款资料。 WhatsApp payment details become available after disbursement.</p>`; const grp = sameOwner(r); return `
  <div class="row" style="margin:6px 0 12px">
    <button class="btn primary" onclick="copyWA(['${esc(id)}'],'owner')">📋 WhatsApp 这台车 / this car</button>
    ${grp.length > 1 ? `<button class="btn" id="btnOwnerWA" data-ids="${esc(grp.map(x=>x.id).join(','))}">📋 车主全部 ${grp.length} 台 / all owner's cars</button>` : ''}
    <button class="btn" onclick="const p=$('#waPrev');p.hidden=!p.hidden;$('#waPrev2').hidden=true">预览 Preview</button>
    ${grp.length > 1 ? `<button class="btn" onclick="const p=$('#waPrev2');p.hidden=!p.hidden;$('#waPrev').hidden=true">预览全部 Preview all</button>` : ''}
  </div>
  <pre id="waPrev" hidden style="white-space:pre-wrap;background:var(--soft);border-radius:10px;padding:12px;font:13px/1.5 inherit;margin:0 0 12px">${esc(waMsg([r], 'owner'))}</pre>
  <pre id="waPrev2" hidden style="white-space:pre-wrap;background:var(--soft);border-radius:10px;padding:12px;font:13px/1.5 inherit;margin:0 0 12px">${esc(waMsg(grp, 'owner'))}</pre>`; })()}
  <div class="kv">
    <div>贷款额 Loan</div><div>${money(r.loan_amount)} × ${r.tenure}</div>
    <div>月供 Monthly</div><div><b>${money(r.monthly)}</b></div>
    <div>首期日 First pmt</div><div>${fd(r.first_payment_date)}${r.due_day?' · 每月 every '+esc(r.due_day):''}</div>
    <div>已付 Paid</div><div>${r.paid_count} 期${r.paid_count_excel?`（${r.paid_count_excel} 系统外 / before system）`:''} <span class="hint">· 逾期数字不对？按下面「修改贷款资料」改系统外已付期数</span></div>
    <div>下期 Next due</div><div>${r.status==='CLOSED'?'—':r.next_due==null?(r.pending?'⏳ 待放款，首期日未定 Pending disbursement':'—'):fd(r.next_due)+' （'+(r.days_left<0?'逾期 overdue '+(-r.days_left)+' 天 days':'in '+r.days_left+' days')+'）'}</div>
    ${r.od_amount_est>0?`<div>逾期金额 Est. overdue</div><div style="color:var(--fail)"><b>${money(r.od_amount_est)}</b></div>`:''}
    <div>交车日 Delivered</div><div>${fd(r.deliver_date)}</div>
    ${r.payments_excel?`<div>旧 Excel 记录</div><div class="hint">${esc(r.payments_excel)}</div>`:''}
    ${r.excel_comments?`<div>旧 Excel 备注</div><div class="hint">${esc(r.excel_comments)}</div>`:''}
    ${(r.history||[]).length?`<div>最近改动</div><div class="hint">${(r.history||[]).slice(-3).reverse().map(h=>esc(fd(h.at.slice(0,10))+' '+h.by+' · '+h.action)).join('<br>')}</div>`:''}
  </div>
  <h3 style="font-size:14px;margin:12px 0 6px">付款记录 Payments</h3>
  <table class="pays"><thead><tr><th>期 #</th><th>日期 Date</th><th>金额 Amount</th><th>方式 Method</th><th>备注 Note</th><th>记录人 By</th></tr></thead><tbody>
  ${(pays||[]).map(p=>`<tr><td>${p.seq}</td><td>${fd(p.paid_date)}</td><td>${money(p.amount)}</td><td>${esc(p.method||'')}</td><td>${esc(p.note||'')}</td><td class="hint">${esc(p.by||'')}</td></tr>`).join('') || '<tr><td colspan="6" class="hint">还没有在系统里记录付款 No payments logged yet</td></tr>'}
  </tbody></table>
  ${canEdit() && r.status!=='CLOSED' && r.pending ? `<p class="hint">放款后才能记录付款。 Payments can be logged after disbursement.</p>` : ''}
  ${canEdit() && r.status!=='CLOSED' && !r.pending ? `
  <div class="card" style="margin-top:10px"><h2>记录第 ${next} 期付款 · Record instalment #${next}</h2>
    <div class="row">
      <div class="field"><label>付款日期 Paid date</label><input id="p_date" type="date" value="${today()}"></div>
      <div class="field"><label>金额 Amount</label><input id="p_amt" type="number" inputmode="decimal" value="${r.monthly}"></div>
      <div class="field"><label>方式 Method</label><select id="p_method">${METHODS.map(m=>`<option>${m}</option>`).join('')}</select></div>
      <div class="field" style="flex:2"><label>备注 Note</label><input id="p_note"></div>
    </div>
    <button class="btn primary" id="btnPay" style="margin-top:8px">记录付款 Save payment</button>
  </div>` : ''}
  ${canEdit() ? `<div class="row" style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line)">
    <button class="btn" id="btnEdit">修改贷款 / 车主资料 Edit loan data</button>
    ${r.status!=='CLOSED' ? `<select id="c_reason"><option value="">结束合约原因 Close reason…</option><option value="OWNER TAKE BACK">车主取回 OWNER TAKE BACK</option><option value="AUCTIONED">贷款公司已拍卖 AUCTIONED BY FINANCIER</option><option value="LOST">失联/追不回 LOST / UNTRACEABLE</option></select><button class="btn danger" id="btnClose">结束合约 Close</button>` : `<button class="btn" id="btnReopen">重新开启 Reopen</button>`}
  </div>
  <div id="closeCheck" hidden class="card" style="border-color:var(--warn);background:var(--warn-bg);color:var(--warn);margin-top:8px">
    <b>⚠ 待核实：${esc(r.check_note||'')}</b><br>
    <select id="c_checkhow" style="margin-top:6px"><option value="">结束前怎么处理？How to handle…</option><option value="clear">已处理，清掉再结束 Resolved — clear & close</option><option value="keep">还没处理，带着待核实结束 Not yet — close but keep flag</option></select>
  </div>` : ''}`;
  $('#drawer').classList.add('open');
  const wrap = fn => async () => { const epoch=authEpoch; try { await fn(r); } catch (e) { if(epoch===authEpoch&&me)toast('失败 Failed: ' + (e.message||e.code)); } };
  if ($('#btnOwnerWA')) $('#btnOwnerWA').onclick = () => copyWA($('#btnOwnerWA').dataset.ids.split(','), 'owner');
  if ($('#btnPendingEdit')) $('#btnPendingEdit').onclick = () => openForm(r);
  if ($('#btnBook')) { $('#btnBook').onclick = wrap(saveBooking); $('#b_partner').onchange = () => { const v = $('#b_partner').value; if (v && v !== 'DIRECT') { $('#b_to').value = v; $('#b_phone').value = partnerPhone(v); } else { $('#b_to').value = ''; $('#b_phone').value = ''; } for(const id of ['b_to','b_phone'])trackDraft({target:$('#'+id)}); }; }
  if ($('#btnCancelBooking')) $('#btnCancelBooking').onclick = () => { const b = $('#btnCancelBooking'); if (b.dataset.armed) { wrap(cancelBooking)(); } else { b.dataset.armed = '1'; b.textContent = '再按一次确定取消 Press again to confirm'; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = '取消预订 Cancel booking'; } }, 4000); } };
  if ($('#btnExtras')) {
    $('#btnExtras').onclick = wrap(saveExtras);
    ['x_target','x_adv','x_gps','x_key','x_notes','x_check','x_advok'].forEach(id => { const el = $('#'+id); if (el) el.addEventListener('input', () => { window.__dirty = true; const b = $('#btnExtras'); b.classList.add('primary'); b.textContent = '💾 保存 Save — 有改动未保存 unsaved'; }); });
  }
  if ($('#btnRentOut')) { $('#btnRentOut').onclick = wrap(rentOut); $('#h_partner').onchange = () => { const v = $('#h_partner').value; if (v && v !== 'DIRECT') { $('#h_to').value = v; $('#h_phone').value = partnerPhone(v); } else { $('#h_to').value = ''; $('#h_phone').value = ''; } for(const id of ['h_to','h_phone'])trackDraft({target:$('#'+id)}); }; }
  if ($('#btnReturn')) $('#btnReturn').onclick = wrap(returnCar);
  if ($('#btnClose')) $('#btnClose').onclick = () => { const b = $('#btnClose'); if (b.dataset.armed) { wrap(closeContract)(); } else { b.dataset.armed = '1'; b.textContent = '再按一次确定 Press again to confirm'; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = '结束合约 Close'; } }, 4000); } };
  if ($('#btnReopen')) $('#btnReopen').onclick = wrap(reopenContract);
  if ($('#btnEdit')) $('#btnEdit').onclick = () => openForm(r);
  if ($('#btnPay')) $('#btnPay').onclick = async () => {
    const d = $('#p_date').value, a = Number($('#p_amt').value);
    if (!d) { toast('请选付款日期 Paid date'); return; }
    if (!(a > 0)) { toast('金额要大于 0 Amount must be > 0'); return; }
    $('#btnPay').disabled = true;
    try { await addPayment(r, {seq:next, paid_date:d, amount:a, method:$('#p_method').value, note:UP($('#p_note').value||''), by: me.name || me.id || '?', at: new Date().toISOString()}); }
    catch (e) { if($('#btnPay'))$('#btnPay').disabled=false; toast('记录失败 Failed: '+(e.message||e.code)); return; }
    toast(`已记录 ${r.plate} 第 ${next} 期`);
  };
}

/* ---------- stock list for rental agents (no customer / loan data) ---------- */
function stockMsg(list){
  const key = r => ((r.brand||'')+' '+(r.model||'').replace(/[\-]/g,'')).toUpperCase().replace(/\s+/g,' ').trim();
  list = [...list].sort((a,b) => key(a).localeCompare(key(b)) || String(a.year).localeCompare(String(b.year)));
  const car = r => [
    `🚗 *${r.plate}* ${[r.brand,r.model,r.year].filter(Boolean).join(' ')}`,
    `Upfront ${r.target_price ? money(r.target_price) : 'TBC'} · Monthly ${money(r.monthly)} × ${r.tenure} mths`,
    `${finName(r.financier)}`,
  ].join('\n');
  const avail = list.filter(r => !r.pending && !r.booking), pre = list.filter(r => r.pending && !r.booking), res = list.filter(r => r.booking);
  const groups = []; avail.forEach(r => { const k = key(r).split(' ').slice(0,2).join(' '); const g = groups.find(x => x.k === k); g ? g.items.push(r) : groups.push({k, items:[r]}); });
  const out = [`*Available cars* (${fd(today())})`];
  if (avail.length) out.push(`*READY — ${avail.length} cars*`, ...groups.map(g => `━━ ${g.k} (${g.items.length}) ━━\n` + g.items.map(car).join('\n\n')));
  if (pre.length) out.push(`*PRE-BOOKING — ${pre.length} cars*\nReserve now, collection date TBC\n\n` + pre.map(car).join('\n\n'));
  if (res.length) out.push(`*RESERVED — ${res.length} cars*\nBooking deposit received\n\n` + res.map(car).join('\n\n'));
  out.push(`Total: ${list.length} cars`);
  return out.join('\n\n');
}
$('#btnStock').onclick = () => {
  const list = filtered().filter(r => r.status !== 'CLOSED' && !r.rented);
  if (!list.length) { toast('没有在库的车 No cars in stock in this filter'); return; }
  const text = stockMsg(list);
  const show = () => { resetPanel('stock');$('#panel').innerHTML = `<h2>库存清单 Stock list · ${list.length} 台<button class="x" onclick="closeDrawer()">×</button></h2>
    <p class="hint">只有车款和 target 租金，没有车主 / 贷款资料，可以直接发给租车 agent。待放款的车写成 Pre-booking，已预订的写 RESERVED，不提放款、不写订车人。 Model & target rent only — no owner, loan or booking-party data — safe to send to rental agents. Pending cars appear as Pre-booking, booked cars as RESERVED.</p>
    <textarea id="stockText" style="width:100%;min-height:50vh;font:13px/1.5 inherit" readonly>${esc(text)}</textarea>
    <button class="btn primary" style="margin-top:8px" onclick="navigator.clipboard.writeText($('#stockText').value).then(()=>toast('已复制 Copied'),()=>{const t=$('#stockText');t.focus();t.select();})">📋 复制 Copy</button>`;
    $('#drawer').classList.add('open'); };
  show();
};


async function openAccess(){
 const token=authEpoch;
 await authorized();
 const members=check(await sb.rpc('rental_list_access'));
 if(token!==authEpoch)return;
 resetPanel('access');
 $('#panel').innerHTML='<h2>租车权限 / Rental access <button class="x" id="closeAccess">×</button></h2><p class="hint">逐个授权已启用的 Admin / Office Admin。撤销后，下次请求即停止访问。</p><div class="accessList">'+members.map(m=>'<div class="card accessRow"><span>'+esc(m.email)+'<br><small>'+esc(m.role)+(m.active?'':' · Inactive')+'</small></span><button class="btn" data-grant="'+m.user_id+'" '+(!m.enabled&&(!m.active||!['admin','office_admin'].includes(m.role))?'disabled':'')+'>'+(m.enabled?'撤销 Revoke':'授权 Grant')+'</button></div>').join('')+'</div><p id="accessError" role="status"></p>';
 $('#drawer').classList.add('open');window.__openId=null;$('#closeAccess').onclick=closeDrawer;
 document.querySelectorAll('[data-grant]').forEach(button=>button.onclick=async()=>{
  const m=members.find(x=>x.user_id===button.dataset.grant);button.disabled=true;
  try{check(await sb.rpc('rental_set_access',{p_user:m.user_id,p_enabled:!m.enabled,p_revision:m.revision}));await openAccess();}
  catch{if($('#accessError'))$('#accessError').textContent='权限未保存，请重新打开后重试。';button.disabled=false;}
 });
}
$('#btnAccess').onclick=()=>openAccess().catch(()=>toast('仅 Super Admin 可管理租车权限。'));
Object.assign(window,{$,closeDrawer,toast,savePartnerPhone,voidHand,askVoid,askEditHand,saveEditHand,cancelEditHand,copyWA});
if(!configured){$('#loginErr').textContent='系统连接未配置。';$('#btnIn').disabled=true;}
else{
 sb.auth.onAuthStateChange((event,session)=>{
  if(event==='PASSWORD_RECOVERY'){location.replace('portal.html'+location.hash);return;}
  if(event==='SIGNED_OUT'){gate('已退出 Signed out.');return;}
  if(event==='INITIAL_SESSION'||(event==='SIGNED_IN'&&session?.user.id!==currentUser)){setTimeout(()=>boot(session),0);}
 });
}

