// Shared presentation/validation helpers. Database RPCs remain authoritative.
export const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '');
export const labels = {
  pending: 'Awaiting Salesman review', needs_information: 'Missing information', complete: 'Completeness checked',
  draft: 'Draft', prepared: 'Prepared, not submitted', submitted: 'Submitted', under_review: 'Under review',
  approved: 'Approved', rejected: 'Rejected', withdrawn: 'Withdrawn', portal: 'Lender portal', email: 'Email',
};
export const label = value => labels[value] || String(value || 'Not recorded');
export function items(value) {
  const result = String(value || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  if (result.length > 30 || result.some(x => x.length > 200)) throw Error('Use up to 30 items, at most 200 characters each.');
  return [...new Set(result)];
}
export function portalURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash && url.hostname.includes('.') && !url.hostname.endsWith('.local') && !/^(localhost|127\.|0\.|169\.254\.|10\.|192\.168\.)/.test(url.hostname) ? url.href : null;
  } catch { return null; }
}
export function emailAddress(value) {
  const address = String(value || '').trim();
  return address.length <= 254 && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(address) ? address : null;
}
export function localDateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
}
export function isoDateTime(value) {
  const time = new Date(value);
  if (!value || !Number.isFinite(time.getTime()) || time.getTime() > Date.now() + 300000) throw Error('Enter the actual submission time, not a future date.');
  return time.toISOString();
}
export function offerNumber(value, name, maximum) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > maximum) throw Error(`Enter a valid ${name}.`);
  return n;
}
export function emailReviewText(application, institution, files) {
  // Deliberately no mailto/send action. Attachments must be attached in the
  // staff member's approved email tool and the destination reviewed there.
  const chosen = new Set(application.attachment_ids || []);
  return `To: ${application.email_to || institution?.email_recipient || ''}\nSubject: ${application.email_subject || ''}\n\n${application.email_body || ''}\n\nAttachment checklist (attach these files manually):\n${files.filter(file => chosen.has(file.id)).map(file => '- ' + file.filename).join('\n') || '- No attachments selected'}\n\nPrepared only. This does not send email or attach files.`;
}

export function staffLabel(staff) {
  const name = staff?.display_name?.trim();
  return name && name !== 'E2 staff' ? name : staff?.email?.trim() || staff?.user_id || 'Not assigned';
}
