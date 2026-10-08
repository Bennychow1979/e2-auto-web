import * as api from './financing-data.js?v=case-1';
import {esc, rm} from './loan-ui.js';
import {checklist, categoryProgress} from './document-fields.js';
import {createDocumentPreview} from './document-preview.js?v=pdf-preview-1';
import {uuid, label, items, portalURL, emailAddress, localDateTime, isoDateTime, offerNumber, emailReviewText} from './financing-core.mjs';

const $ = id => document.getElementById(id), main = $('financeMain');
const params = new URLSearchParams(location.search), sourceKind = params.get('source'), sourceId = params.get('id');
const back = sourceKind === 'loan' ? 'loans.html' : 'intake-workspace.html';
let user = null, snapshot = null, epoch = 0, busy = false, observedAuthUser;
const locked = new Map();
const preview = createDocumentPreview({dialog:$('financeFilePreview'),title:$('financeFileTitle'),content:$('financeFileBody'),closeButton:$('financeFileClose'),download:path => api.download(sourceKind, path)});
const date = value => value ? new Date(value).toLocaleString('en-MY', {dateStyle:'medium',timeStyle:'short'}) : 'Not recorded';
const field = (name, title, type = 'text', value = '', extra = '') => `<label class="field"><span>${esc(title)}</span><input name="${name}" type="${type}" value="${esc(value)}" ${extra}></label>`;
const textArea = (name, title, value = '', extra = '') => `<label class="field"><span>${esc(title)}</span><textarea name="${name}" rows="3" ${extra.includes('maxlength=') ? '' : 'maxlength="1000"'} ${extra}>${esc(value)}</textarea></label>`;
const check = (name, text, required = true, checked = false) => `<label class="checkRow"><input type="checkbox" name="${name}" ${required ? 'required' : ''} ${checked ? 'checked' : ''}><span>${esc(text)}</span></label>`;
const options = (rows, value, key = 'id', display = 'name') => rows.map(row => `<option value="${esc(row[key])}" ${value === row[key] ? 'selected' : ''}>${esc(row[display])}</option>`).join('');
function lock(value) {
  busy = value;
  if (value) main.querySelectorAll('button,input,textarea,select').forEach(el => {locked.set(el, el.disabled); el.disabled = true;});
  else {for (const [el, disabled] of locked) if (el.isConnected) el.disabled = disabled; locked.clear();}
  main.setAttribute('aria-busy', String(value));
}
function gate(message) {
  epoch++; user = null; snapshot = null; preview.close(); lock(false);
  main.innerHTML = `<section class="financeIntro"><h1>Financing case.</h1><p>${esc(message)}</p><a class="primary" href="portal.html">Staff sign in ↗</a></section>`;
  $('financeSignOut').hidden = true;
}
function error(message) {
  const target = $('financeError');
  if (!target) return;
  target.textContent = message; target.focus(); target.scrollIntoView({block:'nearest'});
}
async function refresh(message = '') {
  preview.close(); const run = ++epoch;
  try {
    const result = await api.load(sourceKind, sourceId);
    if (run !== epoch || !user) return;
    snapshot = result; render(message);
  } catch (e) {
    if (run !== epoch || !user) return;
    snapshot = null;
    main.innerHTML = `<section class="financeIntro"><a href="${back}" class="backLink">← Applications</a><h1>Case unavailable.</h1><p>${esc(e.message || 'Could not load this case.')}</p><p>Access may have changed, or case tracking has not been activated in the database. Do not enter or submit an application until this is resolved.</p><button id="financeRetry" class="secondary">Check again</button></section>`;
    $('financeRetry').onclick = () => refresh();
  }
}
async function change(action, message = 'Saved. The case has been refreshed.') {
  if (busy || !user || !snapshot) return;
  const run = epoch; lock(true); $('financeError').textContent = '';
  try {
    await action();
    if (run === epoch && user) await refresh(message);
  } catch (e) {
    if (run === epoch && user) error(e.message || 'Could not save. Review the error and refresh before retrying.');
  } finally {if (user) lock(false);}
}
function render(message = '') {
  const {source, files, workspace:w} = snapshot, c = w?.case;
  const staff = w?.staff || [], applications = w?.applications || [], institutions = w?.institutions || [];
  const person = id => staff.find(p => p.user_id === id)?.display_name || (id ? id : 'Not assigned');
  const sales = c && (user.role === 'super_admin' || c.salesperson === user.id && ['sales','admin'].includes(user.role));
  const office = c && (user.role === 'super_admin' || c.handed_at && c.office_admin === user.id && ['office_admin','admin'].includes(user.role));
  const officeChoices = staff.filter(p => p.active !== false && ['super_admin','office_admin','admin'].includes(p.role)).map(p=>({...p,choice_name:p.display_name+' · '+(p.role==='office_admin'?'Submission Admin':p.role==='super_admin'?'Super Admin':'Inventory Admin')}));
  const coordinators = officeChoices.filter(p=>p.is_dispatcher);
  const globalCoordinator = staff.some(p=>p.user_id===user.id && p.is_dispatcher && p.active!==false);
  const canAssign = c && c.handed_at && (user.role === 'super_admin' || globalCoordinator);
  const ready = c?.review_state === 'complete' && c.reviewed_content_revision === c.content_revision;
  const canProcess = office && c.handed_at && ready;
  const selected = applications.find(a => a.id === c?.selected_application_id);
  const legacyHandover = !c && sourceKind==='intake' && !!source.handed_at;
  const canAdopt = legacyHandover && (user.role==='super_admin' || user.is_dispatcher);
  main.innerHTML = `<div class="financeActions"><a class="backLink" href="${back}">← ${sourceKind === 'loan' ? 'Registered applications' : 'Customer intake'}</a><button class="textButton" id="financeRefresh">Refresh case</button></div>
    <section class="financeIntro"><span class="eyebrow">E2 FINANCING FOLLOW-UP</span><h1>${esc(c?.case_name || source.details?.name || 'Customer case')}</h1><p>${esc(source.vehicle_summary?.name)}${source.vehicle_summary?.plate ? ' · ' + esc(source.vehicle_summary.plate) : ''}</p><p>Case reference ${esc(c?.id || source.id)}</p></section>
    <div class="financeNotice">Customer-provided information requires staff review. Lender decisions and customer choices are recorded by staff. E2 does not log in to a lender portal or send financing email from this page.</div>
    <p id="financeError" class="financeError" role="alert" tabindex="-1"></p><p class="financeMessage" role="status">${esc(message)}</p>
    ${!c ? `<section class="financeSection"><h2>${legacyHandover?'Review the existing handover.':'Start a clear case record.'}</h2>${legacyHandover ? `<div class="financeOwners"><p><strong>Existing Salesman account</strong><span>${esc(source.salesperson || 'Missing assignment')}</span></p><p><strong>Current Submission Admin account</strong><span>${esc(source.office_admin || 'Missing assignment')}</span></p><p><strong>Existing handover</strong><span>${esc(date(source.handed_at))}</span></p></div><p class="financeHint">Verify these existing account IDs against your confirmed staff records before adopting. Names alone are not identity confirmation.</p><p>This legacy guest case has already been handed over. Adopting it switches future progress to the checked financing workflow. Customer details, files, current Admin and existing handover are preserved; new lender applications need a fresh Salesman completeness review.</p>${canAdopt ? `<form data-action="adopt-legacy">${textArea('reason','Reason for adopting this existing handover','','required minlength="10"')}${check('adopt','I reviewed the current Salesman and Admin mapping. Preserve that assignment and start a fresh completeness review before any new lender application.')}<button class="primary">Adopt legacy handover into case tracking</button></form>` : '<p>A configured global loan coordinator or Super Admin must review and explicitly adopt this existing handover.</p>'}` : '<p>Keep the original application and uploaded files. Add a completeness review, Salesman-to-Admin handover and separate application records for each bank or credit company.</p><button class="primary" id="startFinance">Start case tracking</button>'}</section>` : `
    <section class="financeOwners"><p><strong>Salesman</strong><span>${esc(person(c.salesperson))}</span></p><p><strong>Case coordinator</strong><span>${esc(person(c.coordinator))}</span></p><p><strong>Submission Admin</strong><span>${esc(person(c.office_admin))}</span></p><p><strong>${esc(label(c.review_state))}</strong><span>${c.handed_at ? 'Handed over ' + esc(date(c.handed_at)) : 'Salesman review before handover'}</span></p></section>
    ${selected ? `<p class="financeNotice">Customer-selected offer: ${esc(selected.institution_name || institutions.find(i => i.id === selected.institution_id)?.name || 'Institution')} · ${rm(selected.offer_amount)} · ${esc(selected.offer_rate)}% · ${esc(selected.offer_tenure_months)} months. Instruction recorded: ${esc(c.selection_evidence)}</p>` : ''}
    ${c.missing_items?.length ? `<section class="financeSection"><h2>Items to follow up.</h2><ul>${c.missing_items.map(item => `<li>${esc(item)}</li>`).join('')}</ul><p>This is an internal request record. Contact the customer through your approved channel; no message has been sent automatically. ${sourceKind === 'intake' ? 'Salesman follow-up is required: this guest invitation cannot reopen the submitted case or upload extra files. A separate secure supplemental-upload process is not part of this version.' : 'The registered customer can use their existing application and document pages when information is requested.'}</p></section>` : ''}
    ${sales ? `<section class="financeSection"><h2>1. Salesman completeness review.</h2><p>Review the customer details in the original application and every required document below. Record missing items before handover. Upload counts do not verify authenticity or legibility.</p><form data-action="review">
      ${textArea('missing','Missing items, one per line', (c.missing_items || []).join('\n'), 'maxlength="6000"')}
      ${textArea('note','Review / customer follow-up note', c.review_note, 'required')}
      ${check('details','I have checked the customer details and vehicle.',false)}
      ${check('documents','I have opened and checked the required documents and statement months.',false)}
      <p class="financeHint">Both checks and no missing items are required to mark the case complete. Saving missing items does not notify the customer.${sourceKind === 'intake' ? ' Guest supplemental uploads are not available; follow up directly and resolve the supported document path before handover.' : ''}</p><button class="secondary">Save completeness review</button></form></section>` : ''}
    ${sales && ready && !c.handed_at ? `<section class="financeSection"><h2>2. Hand over to case coordinator.</h2><form data-action="handoff"><label class="field"><span>Receiving coordinator</span><select name="office" required><option value="">Choose the receiving coordinator</option>${options(coordinators,c.coordinator,'user_id','choice_name')}</select></label>${textArea('note','Handover note','','required')}${check('access','I confirm the case is complete. This coordinator will receive its details and documents, then assign the Submission Admin.')}<button class="primary">Hand over complete case →</button><p class="financeHint">${coordinators.length ? 'The coordinator receives the case and controls Admin assignment.' : 'No receiving coordinator is configured. Super Admin must verify the staff identity and enable the dispatcher capability before handover.'}</p></form></section>` : ''}
    ${canAssign ? `<section class="financeSection"><h2>Assign the Submission Admin.</h2><p>Your coordinator capability covers all submitted loan cases. You can assign or reassign this Admin after Salesman handover. Submission actions belong to the assigned Admin.</p><form data-action="assign-admin"><label class="field"><span>Responsible Submission Admin</span><select name="office" required><option value="">Choose the Admin</option>${options(officeChoices,c.office_admin,'user_id','choice_name')}</select></label>${textArea('note','Assignment / reassignment reason','','required')}${check('access','Give this Admin access to the case and its documents. The previous Admin loses assigned-case access unless separately authorized as a global loan coordinator or Super Admin.')}<button class="primary">Save Admin assignment</button></form></section>` : ''}
    ${c.handed_at && !c.office_admin ? `<p class="financeNotice">Awaiting ${esc(person(c.coordinator))} to assign the Submission Admin.</p>` : ''}
    <section class="financeSection"><h2>Bank & credit applications.</h2><p>Each institution has its own submission, reference, follow-up and offer. Assignee labels do not grant access to other staff.</p>${!ready && c.handed_at ? '<p class="financeNotice">Customer details or files need Salesman review before further submissions.</p>' : ''}
      ${applications.map(a => applicationHTML(a,{c,files,institutions,staff,person,canProcess,office})).join('') || '<p>No lender applications recorded yet.</p>'}
      ${canProcess ? `<details><summary>Add an institution application</summary>${institutions.some(i=>i.active) ? applicationForm(null,{c,files,institutions,staff}) : '<p>Ask Super Admin to configure verified institution details first. No real institutions or email recipients are supplied automatically.</p>'}</details>` : !c.handed_at ? '<p>Complete the Salesman review and explicit Admin handover first.</p>' : ''}</section>
    ${user.role === 'super_admin' ? institutionHTML(institutions) : ''}
    <section class="financeSection"><details><summary>Case history</summary><ol class="financeTimeline">${(w.history || []).map(e=>`<li><strong>${esc(e.event)}</strong><small>${esc(date(e.created_at))}${e.actor ? ' · '+esc(person(e.actor)) : ''}</small><p class="financeHistoryNote">${esc(e.note || '')}</p></li>`).join('') || '<li>No events yet.</li>'}</ol></details></section>`}
    <section class="financeSection"><h2>Customer documents.</h2><p>${files.length} available files · ${esc(source.applicant_type || 'Applicant type not set')}</p><ul>${checklist(source.applicant_type).map(item=>`<li>${esc(item.label)} · ${esc(categoryProgress(item, files))}</li>`).join('')}</ul><p class="financeHint">Open a file to preview or download it securely. For a lender portal, upload only the required downloaded files. For email, attach the selected files manually in the approved email tool.</p><ul class="financeFiles">${files.map(f=>`<li><span>${esc(f.filename)}<br><small>${esc(f.category)}${f.covered_months?.length ? ' · '+esc(f.covered_months.join(', ')) : ''}</small></span><button class="textButton" data-file="${esc(f.id)}">Preview / download</button></li>`).join('')}</ul></section>`;
  $('financeRefresh').onclick=()=>{if(!busy)void refresh('Case refreshed. Review any changes before continuing.');};
  if ($('startFinance')) $('startFinance').onclick = () => change(()=>api.start(sourceKind,sourceId),'Case tracking started. Review completeness before handover.');
}
function applicationForm(a, {c, files, institutions, staff}) {
  const choices = institutions.filter(i => i.active || i.id === a?.institution_id);
  const assignees = staff.filter(p => p.active !== false && ['office_admin','admin','super_admin'].includes(p.role));
  return `<form data-action="save-application" data-id="${esc(a?.id || '')}"><div class="financeGrid">
    <label class="field"><span>Bank / credit company</span><select name="institution" required><option value="">Choose an institution</option>${options(choices,a?.institution_id)}</select></label>
    <label class="field"><span>Submission channel</span><select name="channel" required><option value="">Choose a confirmed channel</option><option value="portal" ${a?.channel === 'portal' ? 'selected' : ''}>Lender portal</option><option value="email" ${a?.channel === 'email' ? 'selected' : ''}>Email</option></select></label>
    <label class="field"><span>Application assignee (tracking only)</span><select name="assignee" required>${options(assignees,a?.assignee || c.office_admin,'user_id','display_name')}</select></label>
    ${field('subject','Email subject (email only)','text',a?.email_subject || '', 'maxlength="200"')}
    <div class="full">${textArea('body','Email message (email only)',a?.email_body || '', 'maxlength="5000"')}</div></div>
    <fieldset class="financeChecks"><legend>Documents for this institution</legend>${files.map(file=>check('attachment',file.filename,false,(a?.attachment_ids || []).includes(file.id)).replace('name="attachment"',`name="attachment" value="${esc(file.id)}"`)).join('')}<p class="financeHint">This saves a checklist. It does not attach or send files.</p></fieldset>
    ${textArea('missing','Institution-specific missing documents, one per line',(a?.missing_documents || []).join('\n'),'maxlength="6000"')}
    ${textArea('note','Internal application note',a?.note || '')}
    <button class="secondary">${a ? 'Save draft changes' : 'Create application draft'}</button></form>`;
}
function applicationHTML(a, {c, files, institutions, staff, person, canProcess, office}) {
  const i = institutions.find(i=>i.id===a.institution_id), selected=c.selected_application_id===a.id;
  const canEdit=canProcess && ['draft','ready'].includes(a.status);
  const submitted=!!a.submitted_at, portal=portalURL(a.portal_url);
  const destinationCurrent=!!i?.active && a.institution_revision === i.revision;
  const canUsePrepared=canProcess && destinationCurrent && a.status==='ready';
  return `<article class="financeApplication" id="application-${esc(a.id)}"><header><div><h3>${esc(a.institution_name || i?.name || 'Institution')}</h3><span class="financeDraftBadge">${esc(a.status === 'ready' ? 'Reviewed, not submitted' : label(a.status))}</span>${selected ? '<p class="selectedOffer">Customer-selected offer</p>' : ''}</div><p>${esc(label(a.channel))}</p></header>
    <dl><div><dt>Assignee</dt><dd>${esc(person(a.assignee))}</dd></div><div><dt>Submitted</dt><dd>${esc(date(a.submitted_at))}</dd></div><div><dt>Reference</dt><dd>${esc(a.external_reference || 'Not recorded')}</dd></div>${a.offer_amount != null ? `<div><dt>Offer amount</dt><dd>${rm(a.offer_amount)}</dd></div><div><dt>Rate, lender-stated %</dt><dd>${esc(a.offer_rate)}%</dd></div><div><dt>Tenure</dt><dd>${esc(a.offer_tenure_months)} months</dd></div>` : ''}</dl>
    ${a.missing_documents?.length ? `<p>Missing: ${a.missing_documents.map(esc).join(' · ')}</p>` : ''}
    ${i?.required_documents?.length ? `<p class="financeHint">Institution checklist: ${i.required_documents.map(esc).join(' · ')}</p>` : ''}
    ${!submitted && !destinationCurrent ? '<p class="financeNotice">Institution configuration changed or is inactive. Refresh the draft and repeat the review before using a destination or recording submission.</p>' : ''}
    ${a.channel==='portal' ? `<p>${portal && canUsePrepared ? `<button class="secondary" data-portal="${esc(a.id)}">Open configured lender portal ↗</button>` : portal ? 'Recorded portal: '+esc(portal) : 'No verified HTTPS portal configured.'}</p><p class="financeHint">${submitted ? 'Historical destination. Submission was recorded by staff.' : canUsePrepared ? 'Download the needed files below, sign in to the lender portal yourself, and submit there. Return with the actual reference and submission time.' : 'Review the prepared application before using this portal for submission.'}</p>` : submitted || destinationCurrent ? `<details ${submitted ? '' : `data-email="${esc(a.id)}"`}><summary>${submitted ? 'Recorded email & attachment checklist' : 'Review prepared email & attachment checklist'}</summary><div ${submitted ? '' : 'data-email-body hidden'}><p>Recipient snapshot: ${esc(a.email_to || 'Not configured')}</p><textarea class="financeEmailReview" aria-label="Prepared email review" readonly>${esc(emailReviewText(a,i,a.attachment_manifest || files))}</textarea><p class="financeHint">${submitted ? 'Historical preparation snapshot. The successful send was explicitly confirmed by staff; E2 did not send it.' : canUsePrepared ? 'Copy the reviewed text into your approved email tool and attach each listed file manually. Confirm the destination and authority to share the documents before sending. A prepared email is not a submitted application.' : 'Internal preparation only. Save and review the application before using it for a real email. No email has been sent.'}</p></div></details>` : ''}
    ${a.submission_evidence ? `<p class="financeHint">Recorded submission evidence: ${esc(a.submission_evidence)}</p>` : ''}
    ${a.note ? `<p class="financeHistoryNote">Latest note / rate basis: ${esc(a.note)}</p>` : ''}<p class="financeHint">Last updated: ${esc(date(a.updated_at || a.created_at))}</p>
    ${canEdit ? `<details><summary>Edit prepared application</summary>${applicationForm(a,{c,files,institutions,staff})}</details>` : ''}
    ${canProcess && destinationCurrent && a.status==='draft' ? `<details><summary>Review before submission</summary><form data-action="review-application" data-id="${esc(a.id)}">${textArea('note','Document and destination review note','','required')}${check('review','I have checked this institution, submission channel, destination and selected attachments.')}<button class="secondary">Mark reviewed, not submitted</button></form></details>` : ''}
    ${canUsePrepared ? `<details><summary>Record an actual ${a.channel==='email'?'email sent':'portal submission'}</summary><form data-action="submission" data-id="${esc(a.id)}"><p class="financeNotice">Only record a completed action. This form does not send email or submit to a lender. For email, check the sent message and attachment list in your email tool first.</p><div class="financeGrid">${field('time','Actual submission time (your local time)','datetime-local',localDateTime(new Date()),'required step="1"')}${field('reference','Lender reference / sent-message reference','text','','required maxlength="200"')}</div>${textArea('evidence',a.channel==='email'?'Human confirmation: sent-message reference, recipient and evidence of successful sending':'Human confirmation: portal result and reference evidence','','required')}${check('confirmed',a.channel==='email'?'I personally verified this email was sent successfully with the reviewed attachments.':'I personally confirmed successful submission on the lender portal.')}<button class="primary">Record completed submission</button></form></details>` : ''}
    ${office && submitted && !selected ? `<details><summary>Record lender follow-up / offer</summary><form data-action="outcome" data-id="${esc(a.id)}"><label class="field"><span>Lender-reported status</span><select name="status">${['under_review','needs_information','approved','rejected','withdrawn'].map(s=>`<option value="${s}" ${a.status===s?'selected':''}>${esc(label(s))}</option>`).join('')}</select></label>${textArea('missing','Missing documents requested by lender, one per line',(a.missing_documents || []).join('\n'),'maxlength="6000"')}<div class="financeGrid">${field('amount','Offered amount (RM)','number',a.offer_amount??'','min="1" max="100000000" step="0.01"')}${field('rate','Lender-stated annual rate (%)','number',a.offer_rate??'','min="0" max="100" step="0.001"')}${field('tenure','Offered tenure (months)','number',a.offer_tenure_months??'','min="1" max="120" step="1"')}</div>${textArea('note','Actual lender response and rate basis / conditions','','required')}<p class="financeHint">Record whether the rate is flat or effective and any conditions in the note. No eligibility decision is made by E2.</p><button class="secondary">Record follow-up</button></form></details>` : ''}
    ${office && a.status==='approved' && !selected ? `<details><summary>Record this as the customer’s selected offer</summary><form data-action="select" data-id="${esc(a.id)}">${textArea('instruction','Customer instruction: when and how this offer was chosen','','required')}${check('choice','The customer explicitly chose this offer. Recording it does not accept a lender contract or disburse funds.')}<button class="primary">Record customer-selected offer</button></form></details>` : ''}
    </article>`;
}
function institutionHTML(institutions) {
  const form = i => `<form data-action="institution" data-id="${esc(i?.id || '')}"><div class="financeGrid">${field('name','Institution display name','text',i?.name || '','required maxlength="120"')}<label class="field"><span>Institution type</span><select name="kind"><option value="bank">Bank</option><option value="credit_company" ${i?.kind==='credit_company'?'selected':''}>Credit company</option></select></label>${field('portal','Verified HTTPS portal URL','url',i?.portal_url || '','maxlength="1000"')}${field('email','Verified financing email recipient','email',i?.email_to || '','maxlength="254"')}</div>${textArea('required','Required documents, one per line',(i?.required_documents || []).join('\n'),'maxlength="6000"')}${check('active','Available for new applications',false,i?.active??true)}<p class="financeHint">Verify destinations with the institution before enabling. Do not enter credentials, customer details or tokens. This configuration does not send anything.</p><button class="secondary">Save institution configuration</button></form>`;
  return `<section class="financeSection"><details><summary>Institution settings · Super Admin</summary>${institutions.map(i=>`<details><summary>${esc(i.name)}${i.active?'':' · inactive'}</summary>${form(i)}</details>`).join('')}<details><summary>Add a verified institution</summary>${form(null)}</details></details></section>`;
}
async function verifyPreparation(application) {
  const run=epoch, c=snapshot?.workspace?.case;
  if(!user || !c) throw Error('Refresh the case before continuing.');
  const fresh=await api.load(sourceKind,sourceId);
  if(run!==epoch || !user) return false;
  const next=fresh.workspace?.applications.find(a=>a.id===application.id);
  const institution=fresh.workspace?.institutions.find(i=>i.id===application.institution_id);
  if(!next || next.revision!==application.revision || fresh.workspace.case.revision!==c.revision || !institution?.active || institution.revision!==application.institution_revision || fresh.workspace.case.review_state!=='complete') throw Error('Case or institution configuration changed. Refresh the case and repeat the review before using a submission destination.');
  return true;
}
main.addEventListener('toggle', async event=>{
  const details=event.target.closest('details[data-email]');
  if(!details || event.target!==details) return;
  const body=details.querySelector('[data-email-body]'); body.hidden=true;
  if(!details.open || !snapshot || !user) return;
  const app=snapshot.workspace.applications.find(a=>a.id===details.dataset.email);
  try {if(app && await verifyPreparation(app) && details.isConnected && details.open) body.hidden=false;}
  catch(e){if(details.isConnected){details.open=false;error(e.message);}}
},true);
document.addEventListener('visibilitychange',()=>{
  if(document.hidden) main.querySelectorAll('details[data-email]').forEach(details=>{details.open=false;details.querySelector('[data-email-body]').hidden=true;});
});
main.addEventListener('click', async event => {
  const portalButton=event.target.closest('[data-portal]');
  if(portalButton && !busy && snapshot && user){
    const app=snapshot.workspace.applications.find(a=>a.id===portalButton.dataset.portal),run=epoch;
    // Reserve a blank tab during the click gesture (Safari blocks late popups).
    // Detach its opener immediately; no lender destination is loaded until the
    // fresh server snapshot validates this preparation. Close on every failure.
    const popup=window.open('about:blank','_blank');
    if(!popup){error('The browser blocked the portal tab. Allow popups for E2 and try again.');return;}
    popup.opener=null;
    let navigated=false;lock(true);
    try {if(app && await verifyPreparation(app)){const url=portalURL(app.portal_url);if(url){popup.location.replace(url);navigated=true;}}}
    catch(e){if(run===epoch&&user)error(e.message);}
    finally {if(!navigated)popup.close();if(user)lock(false);}
    return;
  }
  const button=event.target.closest('[data-file]');
  if (!button || busy || !snapshot || !user) return;
  const file=snapshot.files.find(file=>file.id===button.dataset.file), run=epoch;
  if(file) void preview.open(file,()=>run===epoch&&!!user);
});
main.addEventListener('submit', event => {
  const form=event.target.closest('form[data-action]'); if(!form) return; event.preventDefault();
  if(busy||!snapshot) return;
  if(form.dataset.action==='adopt-legacy'){const values=new FormData(form);return void change(()=>api.adoptLegacy(sourceKind,snapshot.source,String(values.get('reason')||'').trim()),'Legacy handover adopted. The existing Admin is retained; a fresh Salesman review is required before new lender applications.');}
  if(!snapshot.workspace) return;
  const values=new FormData(form), get=name=>String(values.get(name)||'').trim(), c=snapshot.workspace.case;
  const app=snapshot.workspace.applications.find(a=>a.id===form.dataset.id);
  try {
    switch(form.dataset.action) {
      case 'review': return void change(()=>api.review(c,{details_checked:values.has('details'),documents_checked:values.has('documents'),missing_items:items(get('missing')),review_note:get('note')}));
      case 'handoff': return void change(()=>api.handoff(c,get('office'),get('note')),'Complete case handed over to the receiving coordinator.');
      case 'assign-admin': return void change(()=>api.assignAdmin(c,get('office'),get('note')),'Submission Admin assignment saved.');
      case 'save-application': {
        const payload={institution_id:get('institution'),assignee:get('assignee'),channel:get('channel'),email_subject:get('subject'),email_body:get('body'),attachment_ids:values.getAll('attachment'),missing_documents:items(get('missing')),note:get('note')};
        return void change(()=>api.saveApplication(c,app,payload),'Draft saved. No application has been submitted.');
      }
      case 'review-application': return void change(()=>api.reviewApplication(app,get('note')),'Application reviewed. Complete the actual submission outside E2 before recording it.');
      case 'submission': {
        const payload={submitted_at:isoDateTime(get('time')),external_reference:get('reference'),evidence:get('evidence')};
        return void change(()=>api.recordSubmission(app,payload),'Your confirmed submission has been recorded.');
      }
      case 'outcome': {
        const payload={next_status:get('status'),missing_documents:items(get('missing')),offer_amount:offerNumber(get('amount'),'amount',1e8),offer_rate:offerNumber(get('rate'),'rate',100),offer_tenure_months:offerNumber(get('tenure'),'tenure',120),note:get('note')};
        return void change(()=>api.outcome(app,payload));
      }
      case 'select': return void change(()=>api.selectOffer(c,app,get('instruction')),'The customer’s selected offer has been recorded.');
      case 'institution': {
        const institution=snapshot.workspace.institutions.find(i=>i.id===form.dataset.id);
        if(get('portal')&&!portalURL(get('portal'))) throw Error('Use a verified public HTTPS portal URL without credentials or a fragment.');
        if(get('email')&&!emailAddress(get('email'))) throw Error('Enter one verified email address without extra headers or recipients.');
        const payload={name:get('name'),kind:get('kind'),portal_url:get('portal')||null,email_to:get('email')||null,required_documents:items(get('required')),active:values.has('active')};
        return void change(()=>api.saveInstitution(institution,payload));
      }
    }
  } catch(e) {error(e.message);}
});
$('financeSignOut').onclick=async()=>{try{await api.signOut();gate('Signed out.')}catch(e){gate(e.message)}};
api.db?.auth.onAuthStateChange((event, session)=>{
  if (session?.user?.id) observedAuthUser=session.user.id;
  if(event==='SIGNED_OUT'){observedAuthUser=null;gate('Sign in with your staff account.');}
  else if(user && observedAuthUser !== undefined && observedAuthUser !== user.id) gate('Sign in with your staff account.');
});
window.addEventListener('pagehide',()=>{epoch++;preview.close();snapshot=null;main.replaceChildren();});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload()});
try {
  if(!['intake','loan'].includes(sourceKind)||!uuid(sourceId)) throw Error('Open a financing case from Customer intake or Registered applications.');
  const run=epoch, signedIn=await api.who();
  if(run===epoch){
    if(observedAuthUser !== undefined && observedAuthUser !== signedIn.id) gate('Your signed-in account changed. Open this case again with your staff account.');
    else {user=signedIn;$('financeSignOut').hidden=false;await refresh();}
  }
} catch(e){gate(e.message)}
