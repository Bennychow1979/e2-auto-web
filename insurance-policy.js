import {insuranceEnabled} from './insurance-feature.mjs';
import {FIELDS,policyPatch,registrationKey} from './insurance-core.mjs';
import {analyzePolicy} from './insurance-extract.mjs';
import {createDocumentPreview} from './document-preview.js?v=pdf-preview-1';
import {esc} from './loan-ui.js';
import {uuid} from './financing-core.mjs';
const enabled=insuranceEnabled(),api=enabled?await import('./insurance-data.js?v=1'):null;
const $=id=>document.getElementById(id),main=$('policyMain'),caseId=new URLSearchParams(location.search).get('case');
let user=null,workspace=null,selected=null,epoch=0,busy=false,controller=null,observedUser;
const preview=createDocumentPreview({dialog:$('policyPreview'),title:$('policyPreviewTitle'),content:$('policyPreviewBody'),closeButton:$('policyPreviewClose'),download:path=>api.download(path)});
const date=value=>value?new Date(value).toLocaleString('en-MY'):'Not recorded';
function clear(message){epoch++;controller?.abort();controller=null;preview.close();workspace=null;selected=null;user=null;busy=false;main.setAttribute('aria-busy','false');main.innerHTML=`<section class="financeIntro"><h1>Policy review unavailable.</h1><p>${esc(message)}</p><a class="primary" href="portal.html">Staff sign in</a></section>`;$('policySignOut').hidden=true;}
function error(message){const el=$('policyError');if(el){el.textContent=message;el.focus();}}
function lock(value){busy=value;main.querySelectorAll('button,input,textarea,select').forEach(el=>{el.disabled=value&&el.id!=='policyCancel';});main.setAttribute('aria-busy',String(value));if($('policyCancel'))$('policyCancel').hidden=!value;}
async function refresh(message='',selectId=null){
  const run=++epoch;controller?.abort();preview.close();selected=null;
  try{const next=await api.load(caseId);if(run!==epoch||!user)return;workspace=next;selected=next.documents.find(d=>d.id===selectId&&d.state==='ready')||null;busy=false;render(message);}
  catch(e){if(run!==epoch||!user)return;clear(e.message||'Case access changed.');}
}
function render(message=''){
  main.setAttribute('aria-busy','false');
  const w=workspace,c=w.case,record=w.record?.fields||{};
  const back=`financing-case.html?source=${encodeURIComponent(c.source_kind)}&id=${encodeURIComponent(c.source_id)}`;
  main.innerHTML=`<div class="financeActions"><a class="backLink" href="${esc(back)}">Back to financing case</a><button id="policyRefresh" class="textButton">Reload case (discard draft)</button></div>
    <section class="financeIntro"><span class="eyebrow">INSURANCE POLICY REVIEW</span><h1>${esc(c.case_name)}</h1><p>Case ${esc(c.id)}</p><p>Customer: ${esc(w.source?.name||'Not recorded')} · Vehicle registration: ${esc(w.source?.plate||'Not recorded')}</p></section>
    <p class="financeNotice">This records an existing policy. It does not obtain insurance, issue cover or confirm validity. Text PDFs are analyzed on this device. Scanned PDFs and images need manual entry; no external OCR service is connected.</p>
    <p id="policyError" class="financeError" role="alert" tabindex="-1"></p><p id="policyStatus" class="financeMessage" role="status">${esc(message)}</p>
    <section class="financeSection"><h2>Saved policy details.</h2><dl class="financeOwners">${FIELDS.map(([key,title])=>`<p><strong>${esc(title)}</strong><span>${esc(record[key]??'Not recorded')}</span></p>`).join('')}</dl><p class="financeHint">${w.record?'Revision '+esc(w.record.revision)+' · Last reviewed '+esc(date(w.record.updated_at)):'No reviewed policy fields saved yet.'} Original customer details and vehicle records are unchanged.</p></section>
    ${w.can_write?`<section class="financeSection"><h2>Upload a policy original.</h2><form id="policyUpload"><label class="field"><span>Policy PDF, JPG or PNG</span><input id="policyFile" type="file" accept="application/pdf,image/jpeg,image/png" required></label><p class="financeHint">Up to 10 MB; PDFs up to 20 pages. Labelled text fields only. Ambiguous dates, currencies or conflicting values stay blank for review. Original bytes are retained privately; selecting a file alone does not upload it.</p><button class="primary">Upload and prepare review</button></form><button id="policyCancel" class="secondary" hidden>Cancel current action</button></section>`:'<p class="financeNotice">Read-only case access. Only the currently assigned Submission Admin or Super Admin can upload and save policy fields.</p>'}
    <section class="financeSection"><h2>Policy originals.</h2><ul class="policyOriginals">${w.documents.map(d=>`<li><strong>${esc(d.filename)}</strong><small>${esc(d.state==='ready'?'Original retained':'Incomplete upload — select the same file to retry')} · ${esc(date(d.created_at))}</small><small>Client-reported SHA-256: ${esc(d.client_sha256)}</small>${d.state==='ready'?`<div class="policyActions"><button class="secondary" data-preview="${esc(d.id)}">Preview original</button>${w.can_write?`<button class="secondary" data-review="${esc(d.id)}">Review fields</button>`:''}</div>`:''}</li>`).join('')||'<li>No policy originals uploaded.</li>'}</ul></section>
    ${selected&&w.can_write?reviewHTML(selected,record):''}
    <section class="financeSection"><details><summary>Policy review history</summary><ol class="financeTimeline">${w.history.map(e=>`<li><strong>${e.event==='review_saved'?'Reviewed fields saved':'Policy original uploaded'}</strong><small>${esc(date(e.created_at))} · ${esc(e.actor)}</small><p>Original: ${esc(w.documents.find(d=>d.id===e.document_id)?.filename||e.document_id)}</p><p class="financeHistoryNote">${esc(e.note)}</p>${e.event==='review_saved'?`<dl class="policyAudit">${FIELDS.filter(([key])=>Object.hasOwn(e.provenance||{},key)).map(([key,title])=>`<dt>${esc(title)}</dt><dd>${esc(e.before_fields[key]??'Not recorded')} → ${esc(e.after_fields[key])}<br>${esc(e.provenance[key].method==='reviewed_local_suggestion'?'Locally extracted; checked by staff':'Entered or corrected by staff')}</dd>`).join('')}</dl>`:''}</li>`).join('')||'<li>No policy events recorded.</li>'}</ol></details></section>`;
  $('policyRefresh').onclick=()=>{if(!busy)void refresh('Case reloaded. Check current values before saving.');};
  if($('policyCancel'))$('policyCancel').onclick=()=>{epoch++;controller?.abort();controller=null;preview.close();selected=null;busy=false;render('Action cancelled. An in-flight upload or save may already have completed; reload the case before retrying. No further processing will continue.');};
}
function reviewHTML(document,current){
  return `<section class="financeSection" id="policyReview"><h2>Check against the original.</h2><p>${esc(document.filename)} · ${document.extraction.mode==='text_pdf'?'Unverified local text suggestions':'No OCR performed. Enter fields manually after checking the original.'}</p><button class="secondary" data-preview="${esc(document.id)}">Preview this original</button><form id="policyReviewForm"><fieldset class="policyFields"><legend>Select only fields you have checked</legend>${FIELDS.map(([key,title,kind])=>{
    const f=document.extraction.fields[key],value=f.value??'';
    return `<div class="policyField"><div><strong>${esc(title)}</strong><p>Saved: ${esc(current[key]??'Not recorded')}</p><p class="policyEvidence">${esc(f.issue)}${f.page?' · Page '+esc(f.page):''}${f.excerpt?'<br>'+esc(f.excerpt):''}</p></div><div><label class="field"><span>${esc(title)} to save</span><input name="${key}" value="${esc(value)}" type="${kind==='date'?'date':'text'}" ${['money','percent'].includes(kind)?'inputmode="decimal"':''} maxlength="160"></label><label class="checkRow"><input type="checkbox" name="selected" value="${key}"><span>Use checked ${esc(title)}</span></label></div></div>`;
  }).join('')}</fieldset><p id="policyConflicts" class="policyConflict" role="status"></p><div class="policyChecks"><label class="checkRow"><input type="checkbox" name="replace"><span>I explicitly approve replacing the conflicting saved values selected above.</span></label><label class="checkRow"><input type="checkbox" name="belongs" required><span>I checked that this original belongs to this case and vehicle.</span></label><label class="checkRow"><input type="checkbox" name="reviewed" required><span>I checked every selected value against the original. Suggestions are not proof of correctness.</span></label></div><label class="field"><span>Review note and any corrections</span><textarea name="note" required minlength="10" maxlength="1000" rows="3"></textarea></label><p class="financeHint">Unselected values stay unchanged. Blank values cannot erase saved information.</p><button class="primary">Save checked policy fields</button></form></section>`;
}
function conflicts(form){const f=new FormData(form),current=workspace.record?.fields||{};return f.getAll('selected').filter(key=>current[key]!=null&&current[key]!==String(f.get(key)||'').trim());}
main.addEventListener('input',event=>{const form=event.target.closest('#policyReviewForm');if(form)$('policyConflicts').textContent=conflicts(form).length?'Selected fields conflict with saved values: '+conflicts(form).map(key=>FIELDS.find(f=>f[0]===key)[1]).join(', '):'';});
main.addEventListener('click',event=>{
  const button=event.target.closest('[data-preview],[data-review]');if(!button||busy||!workspace||!user)return;
  const doc=workspace.documents.find(d=>d.id===(button.dataset.preview||button.dataset.review)&&d.state==='ready');if(!doc)return;
  if(button.dataset.review){selected=doc;render();$('policyReview').scrollIntoView({block:'start'});}
  else{const run=epoch;void preview.open(doc,()=>run===epoch&&!!user);}
});
main.addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!workspace?.can_write||!user)return;
  const form=event.target,run=epoch;lock(true);error('');
  const current=()=>run===epoch&&!!user;
  try{
    if(form.id==='policyUpload'){
      const file=$('policyFile').files[0];controller=new AbortController();$('policyStatus').textContent='Analyzing locally. No policy fields have been saved.';
      const analysis=await analyzePolicy(file,{signal:controller.signal});if(!current())return;
      let doc=await api.reserve(workspace.case,file,analysis);if(!current())return;
      if(doc.case_id!==caseId)throw Error('Upload reservation does not match this case.');
      if(doc.state!=='ready'){$('policyStatus').textContent='Uploading the private original. Fields still need review.';await api.upload(doc,file);if(!current())return;doc=await api.finish(workspace.case,doc,analysis.extraction);if(!current())return;}
      await refresh('Original retained. Review and select fields before saving.',doc.id);
    }else if(form.id==='policyReviewForm'&&selected){
      // Disabled fields are omitted from FormData, so temporarily restore the
      // form controls while reading, without yielding or allowing a second save.
      form.querySelectorAll('input,textarea').forEach(el=>el.disabled=false);
      const values=new FormData(form);form.querySelectorAll('input,textarea').forEach(el=>el.disabled=true);
      const keys=values.getAll('selected'),replacement=values.has('replace')?keys.filter(k=>workspace.record?.fields[k]!=null):[];
      const patch=policyPatch(Object.fromEntries(values),keys,workspace.record?.fields||{},replacement);
      if(patch.registration&&workspace.source?.plate&&registrationKey(patch.registration)!==registrationKey(workspace.source.plate))throw Error('Vehicle registration differs from this case. Choose the correct case and policy.');
      await api.save(workspace,selected,{patch,replace_fields:replacement,reviewed:values.has('reviewed'),case_confirmed:values.has('belongs'),note:String(values.get('note')||'').trim()});if(!current())return;
      await refresh('Checked policy fields saved. Original and review history retained.');
    }
  }catch(e){if(current()){error(e.name==='AbortError'?'Local analysis was cancelled or timed out. Retry with a supported file.':e.message||'Could not complete this action. Reload before retrying.');$('policyStatus').textContent='Action stopped. Reload to check whether an upload or save completed before retrying.';}}
  finally{if(current()){controller=null;lock(false);}}
});
$('policySignOut').onclick=async()=>{try{await api.signOut();clear('Signed out.');}catch(e){clear(e.message);}};
api?.db.auth.onAuthStateChange((event,session)=>{if(session?.user?.id)observedUser=session.user.id;if(event==='SIGNED_OUT'){observedUser=null;clear('Sign in with your staff account.');}else if(user&&observedUser!==undefined&&observedUser!==user.id)clear('Your signed-in account changed.');});
window.addEventListener('pagehide',()=>{epoch++;controller?.abort();preview.close();workspace=null;selected=null;user=null;main.replaceChildren();});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
if(!enabled)main.innerHTML='<section class="financeIntro"><h1>Insurance policy review is not enabled yet.</h1><p>Backend setup and activation require separate approval.</p><a class="primary" href="intake-workspace.html">Customer intake</a></section>';
else try{if(!uuid(caseId))throw Error('Open policy review from the correct financing case.');const run=epoch,signedIn=await api.who();if(run===epoch){if(observedUser!==undefined&&observedUser!==signedIn.id)clear('Your signed-in account changed.');else{user=signedIn;$('policySignOut').hidden=false;await refresh();}}}catch(e){clear(e.message);}
