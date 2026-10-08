import {db, check} from './e2-data.js';
export {db};
const rpc = (name, args) => db.rpc(name, args).then(check).then(value => Array.isArray(value) ? value[0] : value);
export async function who() {
  const user = check(await db.auth.getUser()).user;
  if (!user) throw Error('Sign in with your staff account.');
  const member = check(await db.from('staff_memberships').select('role,active').eq('user_id', user.id).single());
  if (!member.active || !['super_admin','admin','office_admin','sales'].includes(member.role)) throw Error('Staff financing access required.');
  return {...user, role: member.role};
}
export async function load(source, id) {
  const intake = source === 'intake';
  const row = check(await db.from('finance_cases').select('id').eq(intake ? 'intake_id' : 'loan_id', id).maybeSingle());
  if (row) {
    // The RPC returns case revision, customer details and files in one stable
    // database snapshot. Never pair newer review revisions with older file lists.
    const workspace = await rpc('e2_finance_workspace', {target: row.id});
    return {source: workspace.source, files: workspace.files, workspace};
  }
  const app = check(await db.from(intake ? 'intake_submissions' : 'loan_applications').select('*').eq('id', id).single());
  if (!app.submitted_at) throw Error('Only submitted customer applications can be processed.');
  const files = check(await db.from(intake ? 'intake_files' : 'loan_documents').select('*').eq(intake ? 'submission_id' : 'application_id', id).eq('state', 'ready').order('created_at')).filter(file => !file.removed_at);
  return {source: app, files, workspace: null};
}
export const start = (source_kind, source_id) => rpc('e2_open_finance_case', {source_kind, source_id});
export const review = (a, params) => rpc('e2_review_finance_case', {target:a.id,expected_revision:a.revision,...params});
export const handoff = (a, office, message) => rpc('e2_handoff_finance_case', {target:a.id,office,message,expected_revision:a.revision});
export const assignAdmin = (a, office, message) => rpc('e2_assign_finance_admin', {target:a.id,office,message,expected_revision:a.revision});
export const saveApplication = (a, application, payload) => rpc('e2_save_finance_application', {target:a.id,application_id:application?.id || null,expected_revision:application?.revision || null,payload});
export const reviewApplication = (a, review_note) => rpc('e2_review_finance_application', {target:a.id,expected_revision:a.revision,review_note});
export const recordSubmission = (a, params) => rpc('e2_record_finance_submission', {target:a.id,expected_revision:a.revision,...params});
export const outcome = (a, params) => rpc('e2_record_finance_outcome', {target:a.id,expected_revision:a.revision,...params});
export const selectOffer = (a, application, customer_instruction) => rpc('e2_select_finance_offer', {target:a.id,application_id:application.id,expected_application_revision:application.revision,expected_revision:a.revision,customer_instruction});
export const saveInstitution = (institution, payload) => rpc('e2_save_finance_institution', {target:institution?.id || null,payload,expected_revision:institution?.revision || null});
export const download = (source, path) => db.storage.from(source === 'intake' ? 'intake-documents' : 'loan-documents').download(path).then(check);
export const signOut = () => db.auth.signOut({scope:'local'}).then(check);
